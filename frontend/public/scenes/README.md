# Scenes for generated pictures

The surfaces and lighting that "Generate pictures" places a model in (`src/utils/scenePictures/scenes.ts`). All are
from [Poly Haven](https://polyhaven.com) and released under [CC0](https://creativecommons.org/publicdomain/zero/1.0/):
free to use, change and ship, with no credit required. They're credited here anyway.

Surfaces, photo-scanned, at 2048 px for colour and 1024 px for relief (`normal`) and gloss (`rough`), as WebP:

| Folder               | Poly Haven asset                                                       | Real size |
| -------------------- | ---------------------------------------------------------------------- | --------- |
| `surfaces/oak-desk`  | [Wood Table 001](https://polyhaven.com/a/wood_table_001)               | 1.5 m     |
| `surfaces/workbench` | [Wood Table Worn](https://polyhaven.com/a/wood_table_worn)             | 55 cm     |
| `surfaces/plywood`   | [Plywood](https://polyhaven.com/a/plywood)                             | 50 cm     |
| `surfaces/white-oak` | [White Oak Veneer](https://polyhaven.com/a/white_oak_veneer)           | 50 cm     |
| `surfaces/walnut`    | [Smoked Walnut Veneer](https://polyhaven.com/a/smoked_walnut_veneer)   | 1 m       |
| `surfaces/leather`   | [Brown Leather](https://polyhaven.com/a/brown_leather)                 | 40 cm     |
| `surfaces/wool`      | [Poly Wool Herringbone](https://polyhaven.com/a/poly_wool_herringbone) | 27 cm     |

Lighting, 1K HDR panoramas of real rooms:

| File                             | Poly Haven asset                                                     |
| -------------------------------- | -------------------------------------------------------------------- |
| `light/artist_workshop.hdr`      | [Artist Workshop](https://polyhaven.com/a/artist_workshop)           |
| `light/lebombo.hdr`              | [Lebombo](https://polyhaven.com/a/lebombo)                           |
| `light/brown_photostudio_02.hdr` | [Brown Photostudio 02](https://polyhaven.com/a/brown_photostudio_02) |
| `light/studio_small_09.hdr`      | [Studio Small 09](https://polyhaven.com/a/studio_small_09)           |

A surface needs a scan small enough to stay sharp under a small print: a 2 m scan at 2K is 1 mm per pixel, which reads
as a blur beside a 40 mm keyring. Keep new ones under about 1 m, and give their real size in `scenes.ts`.
