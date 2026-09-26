# Texture credits

All textures below are licensed **CC0 1.0 Universal (public domain)**. Attribution is not required but is given here with thanks.

Maps were downloaded at 2K and re-encoded to WebP (diffuse sRGB q85; OpenGL +Y normals q80; ARM = R ambient occlusion, G roughness, B metalness 0, near-lossless; optional grayscale height, percentile-stretched to 0..1). `*.1k.webp` are 2:1 box-downsampled versions for the low quality preset. Build scripts live in `asset-pipeline/textures/`.

Modifications: `marble` (ambientCG Marble019) ships no AO map, so its ARM red channel is white; its normal map was re-derived from the source displacement map because the supplied NormalGL is nearly flat.

| Set | Source | Asset id | Title | Author(s) | Scanned size | Licence | URL |
| --- | --- | --- | --- | --- | --- | --- | --- |
| cliff | Poly Haven | `marble_cliff_05` | Marble Cliff 05 | Amal Kumar | 20 m | CC0 | https://polyhaven.com/a/marble_cliff_05 |
| rock_detail | Poly Haven | `rock_boulder_dry` | Rock Boulder Dry | Dimitrios Savva (Photography), Rico Cilliers (Processing) | 1.8 m | CC0 | https://polyhaven.com/a/rock_boulder_dry |
| moss | Poly Haven | `coast_sand_rocks_02` | Coast Sand Rocks 02 | Rob Tuytel | 15 m | CC0 | https://polyhaven.com/a/coast_sand_rocks_02 |
| grass | Poly Haven | `forrest_ground_01` | Forest Ground 01 | Rob Tuytel | 2 m | CC0 | https://polyhaven.com/a/forrest_ground_01 |
| gravel | Poly Haven | `rocky_trail` | Rocky Trail | Amal Kumar | 2 m | CC0 | https://polyhaven.com/a/rocky_trail |
| paving | Poly Haven | `large_grey_tiles` | Large Grey Tiles | Rob Tuytel | 3 m | CC0 | https://polyhaven.com/a/large_grey_tiles |
| marble | ambientCG | `Marble019` | Marble 019 | ambientCG (Lennart Demes) | n/a | CC0 | https://ambientcg.com/view?id=Marble019 |
| roof_tiles | Poly Haven | `grey_roof_tiles` | Grey Roof Tiles | Rob Tuytel | 3 m | CC0 | https://polyhaven.com/a/grey_roof_tiles |

- Poly Haven licence: https://polyhaven.com/license
- ambientCG licence: https://docs.ambientcg.com/license/
