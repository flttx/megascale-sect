// Preview helper: character GLB (meshopt decoded) + clips from an anim GLB, bound by node NAME
// (the same rule three.js uses), written as a plain GLB that Blender can import.
import { io } from './lib.mjs'
const [charFile, animFile, outFile] = process.argv.slice(2)
const doc = await io.read(charFile)
const anim = await io.read(animFile)
for (const ext of doc.getRoot().listExtensionsUsed()) if (ext.extensionName === 'EXT_meshopt_compression') ext.dispose()
const byName = new Map(doc.getRoot().listNodes().map((n) => [n.getName(), n]))
const buffer = doc.getRoot().listBuffers()[0]
let missing = 0
for (const a of anim.getRoot().listAnimations()) {
  const dst = doc.createAnimation(a.getName())
  for (const ch of a.listChannels()) {
    const node = byName.get(ch.getTargetNode().getName())
    if (!node) { missing++; continue }
    const s = ch.getSampler()
    const cp = (acc) => doc.createAccessor().setType(acc.getType()).setArray(acc.getArray().slice()).setNormalized(acc.getNormalized()).setBuffer(buffer)
    const ds = doc.createAnimationSampler().setInput(cp(s.getInput())).setOutput(cp(s.getOutput())).setInterpolation(s.getInterpolation())
    dst.addSampler(ds).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath(ch.getTargetPath()).setSampler(ds))
  }
}
if (missing) throw new Error(`${missing} channels had no matching node name`)
await io.write(outFile, doc)
process.stdout.write(`wrote ${outFile}\n`)
