import { useFrame } from '@react-three/fiber'
import { useEffect } from 'react'
import { Vector3 } from 'three'
import { useUiStore } from '../../ui/uiStore'
import { translate } from '../../ui/i18n'
import { facingYaw, sitesOf, TELEPORT_PAD_TOP } from '../interact/registry'
import { getPlayerRuntime, respawnPlayer } from '../player/playerHandle'
import { useWorldStore } from '../store'
import { beginBlackMistHazardFrame, pendingBlackMistHit, recordBlackMistHit, resetBlackMistHazards } from './hazards'

const ARRAYS = sitesOf('teleport')
const sitePoint = new Vector3()

/** Resolve visible strike volumes after anatomy updates, before the sound/camera pass. */
export function BlackMistHazards() {
  useEffect(() => resetBlackMistHazards, [])
  useFrame(({ camera }) => beginBlackMistHazardFrame(!!camera.userData.review), -0.95)
  useFrame(({ scene }) => {
    const hit = pendingBlackMistHit(),
      player = getPlayerRuntime()
    if (!hit || !player) return
    const at = player.position.clone()
    let site = ARRAYS[0],
      distance = Infinity
    for (const candidate of ARRAYS) {
      const d = at.distanceToSquared(sitePoint.set(...candidate.position))
      if (d < distance) {
        distance = d
        site = candidate
      }
    }
    const destination = new Vector3(...site.position)
    destination.y += TELEPORT_PAD_TOP + 0.03
    if (!respawnPlayer(destination.toArray() as [number, number, number], facingYaw(site.position, site.faceToward)))
      return
    const restored = getPlayerRuntime()!
    recordBlackMistHit(hit, at, site.id, restored.position)
    scene.getObjectByName('playerRoot')?.position.copy(restored.position)
    const ui = useUiStore.getState()
    ui.activateArray(site.id)
    ui.flash()
    ui.setNearby(null)
    window.dispatchEvent(new Event('black-mist-respawn'))
    useWorldStore.getState().setPhase(restored.phase)
    useWorldStore
      .getState()
      .setNotice(
        translate('异变吞没了你 · 已在{site}重凝形体', ui.language, { site: translate(site.name, ui.language) }),
      )
  }, -0.7)
  return null
}
