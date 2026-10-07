import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type { InstancedBufferGeometry, Mesh } from 'three'
import { ambientAudio } from '../audio/ambientAudio'
import { worldEvents } from '../events'
import { URL_OVERRIDES, useWorldStore, type WeatherKind } from '../store'
import { atmosphere } from '../sky/atmosphere'
import { Lightning } from './Lightning'
import { Precipitation } from './Precipitation'
import { SURFACE_WEATHER_UNIFORMS } from './surfaceWeather'
import { setHours, tickTime } from './timeOfDay'
import { applyWeather, autoWeatherDuration, pickNextWeather, snapWeather, tickWeather, weather } from './weatherMachine'
import { blackMistRuntime } from '../blackMist/runtime'
import { applyBlackMistAtmosphere } from '../blackMist/atmosphere'

/** Seconds before auto weather resumes after the player picks a weather at the altar. */
const MANUAL_HOLD = 480

interface Strike {
  next: number
  flicker: number
}

/** Fires one lightning strike somewhere around the camera (also used by the dev hook). */
function strike(cameraX: number, cameraZ: number, random = Math.random) {
  const angle = random() * Math.PI * 2,
    distance = 280 + random() * 1300
  const position = [cameraX + Math.cos(angle) * distance, -84, cameraZ + Math.sin(angle) * distance] as const
  weather.flash = Math.max(weather.flash, 0.75 + random() * 0.25) * Math.min(1, 900 / distance + 0.35)
  worldEvents.emit('lightning', { position, distance })
}

/**
 * Drives the day clock and weather ahead of every consumer (priority -2 runs before the player at -1
 * and the sky, lights and post FX at 0), then layers the blended weather onto the atmosphere.
 */
export function WeatherSystem() {
  const auto = useRef({ remaining: autoWeatherDuration('clear'), expected: useWorldStore.getState().weather })
  const lightning = useRef<Strike>({ next: 8, flicker: -1 })
  const camera = useRef({ x: 0, z: 150 })
  const scene = useThree((state) => state.scene)

  useEffect(() => {
    if (URL_OVERRIDES.hours !== null) setHours(URL_OVERRIDES.hours)
    if (URL_OVERRIDES.weather) snapWeather(URL_OVERRIDES.weather)
    // A weather the auto picker did not choose came from the player: hold it for a while.
    const unsubscribe = useWorldStore.subscribe((state, previous) => {
      if (state.weather === previous.weather || state.weather === auto.current.expected) return
      auto.current = { remaining: MANUAL_HOLD, expected: state.weather }
    })
    const offThunder = worldEvents.on('lightning', ({ distance }) => {
      if (!blackMistRuntime.active) ambientAudio.thunder(distance)
    })
    const hooks = window as unknown as Record<string, unknown>
    if (import.meta.env.DEV) {
      hooks.__setTimeOfDay = (hours: number) => {
        setHours(hours)
        useWorldStore.getState().setTimePaused(true)
      }
      hooks.__setWeather = (kind: WeatherKind, instant = true) => {
        const store = useWorldStore.getState()
        store.setAutoWeather(false)
        store.setWeather(kind)
        if (instant) snapWeather(kind)
      }
      hooks.__strikeLightning = () => strike(camera.current.x, camera.current.z)
      // Live particle counts let verification assert precipitation is actually drawn.
      const drawn = (name: string) => {
        const mesh = scene.getObjectByName(name) as Mesh<InstancedBufferGeometry> | undefined
        return mesh?.visible ? mesh.geometry.instanceCount : 0
      }
      hooks.__audioState = () => ambientAudio.stats()
      hooks.__weatherState = () => ({
        hours: atmosphere.hours,
        target: weather.target,
        ...weather.blend,
        wetness: weather.wetness,
        snowCover: weather.snowCover,
        flash: weather.flash,
        rainDrawn: drawn('Rain'),
        snowDrawn: drawn('Snow'),
      })
    }
    return () => {
      unsubscribe()
      offThunder()
      for (const key of ['__setTimeOfDay', '__setWeather', '__strikeLightning', '__weatherState', '__audioState'])
        delete hooks[key]
    }
  }, [scene])

  useFrame((state, rawDelta) => {
    // Clamp tab-switch spikes so fronts and the clock never jump.
    const delta = Math.min(rawDelta, 0.1)
    const store = useWorldStore.getState()
    camera.current.x = state.camera.position.x
    camera.current.z = state.camera.position.z
    tickTime(delta, store.timeScale, store.timePaused || blackMistRuntime.cinematic)

    if (store.autoWeather && !blackMistRuntime.cinematic) {
      const a = auto.current
      a.remaining -= delta
      if (a.remaining <= 0) {
        const next = pickNextWeather(store.weather)
        auto.current = { remaining: autoWeatherDuration(next), expected: next }
        store.setWeather(next)
      }
    }
    tickWeather(delta, store.weather)

    // Storm lightning: a strike every 6–18 s, each with a quick second flicker.
    const l = lightning.current
    if (weather.blend.storm > 0.6 && !blackMistRuntime.cinematic) {
      l.next -= delta
      if (l.next <= 0) {
        strike(state.camera.position.x, state.camera.position.z)
        l.next = 6 + Math.random() * 12
        l.flicker = 0.09 + Math.random() * 0.08
      }
      if (l.flicker > 0 && (l.flicker -= delta) <= 0) weather.flash = Math.max(weather.flash, 0.6 + Math.random() * 0.3)
    } else {
      l.next = Math.max(l.next, 3)
    }
    applyWeather()
    applyBlackMistAtmosphere()
    const surface = SURFACE_WEATHER_UNIFORMS
    surface.uWxWetness.value = weather.wetness
    surface.uWxSnow.value = weather.snowCover
    surface.uWxRain.value = Math.min(1, weather.blend.rain)
    surface.uWxTime.value = state.clock.elapsedTime % 1000
    ambientAudio.update(delta, store.started && !blackMistRuntime.active, state.camera.position.y)
  }, -2)

  return (
    <>
      <Precipitation />
      <Lightning />
    </>
  )
}
