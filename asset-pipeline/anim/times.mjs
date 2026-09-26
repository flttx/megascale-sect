import { io } from './lib.mjs'
const doc = await io.read(process.argv[2])
const t = doc.getRoot().listAnimations()[0].listSamplers()[0].getInput().getArray()
console.log(Array.from(t).map((v) => v.toFixed(4)).join(' '))
