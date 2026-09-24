"""Read-only GLB inventory for the source assets."""
import json
import struct
import sys
from pathlib import Path


def inspect(path: Path):
    with path.open("rb") as stream:
        header = stream.read(12)
        magic, version, length = struct.unpack("<4sII", header)
        if magic != b"glTF" or version != 2:
            raise ValueError(f"Unsupported GLB: {path}")
        chunk_length, chunk_type = struct.unpack("<I4s", stream.read(8))
        if chunk_type != b"JSON":
            raise ValueError(f"Missing JSON chunk: {path}")
        data = json.loads(stream.read(chunk_length))
    meshes = data.get("meshes", [])
    accessors = data.get("accessors", [])
    images = data.get("images", [])
    bin_start = 12 + 8 + chunk_length + 8
    image_info = []
    with path.open("rb") as stream:
        for image in images:
            view = data["bufferViews"][image["bufferView"]]
            stream.seek(bin_start + view.get("byteOffset", 0))
            payload = stream.read(view["byteLength"])
            dimensions = None
            if payload[:2] == b"\xff\xd8":
                cursor = 2
                while cursor + 9 < len(payload):
                    if payload[cursor] != 0xFF:
                        cursor += 1
                        continue
                    marker = payload[cursor + 1]
                    cursor += 2
                    if marker in (0xD8, 0xD9) or 0xD0 <= marker <= 0xD7:
                        continue
                    segment_length = int.from_bytes(payload[cursor:cursor + 2], "big")
                    if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                        dimensions = [int.from_bytes(payload[cursor + 5:cursor + 7], "big"), int.from_bytes(payload[cursor + 3:cursor + 5], "big")]
                        break
                    cursor += segment_length
            image_info.append({"name": image.get("name"), "mime": image.get("mimeType"), "bytes": view["byteLength"], "dimensions": dimensions})
    textures = data.get("textures", [])
    positions = []
    triangles = 0
    primitives = 0
    for mesh in meshes:
        for primitive in mesh.get("primitives", []):
            primitives += 1
            index = primitive.get("attributes", {}).get("POSITION")
            if index is not None:
                accessor = accessors[index]
                if "min" in accessor and "max" in accessor:
                    positions.append((accessor["min"], accessor["max"]))
            count = accessors[primitive["indices"]]["count"] if "indices" in primitive else accessors[index]["count"]
            triangles += count // 3
    local_bounds = None
    if positions:
        local_bounds = {
            "min": [min(bounds[0][axis] for bounds in positions) for axis in range(3)],
            "max": [max(bounds[1][axis] for bounds in positions) for axis in range(3)],
        }
    return {
        "file": str(path), "bytes": length, "meshes": len(meshes),
        "primitives": primitives, "triangles": triangles,
        "images": len(images), "textures": len(textures),
        "local_accessor_bounds": local_bounds,
        "nodes": len(data.get("nodes", [])),
        "root_nodes": data.get("scenes", [{}])[data.get("scene", 0)].get("nodes", []),
        "root_transforms": [data["nodes"][i] for i in data.get("scenes", [{}])[data.get("scene", 0)].get("nodes", [])],
        "image_info": image_info,
    }


for filename in sys.argv[1:]:
    print(json.dumps(inspect(Path(filename)), ensure_ascii=False, indent=2))
