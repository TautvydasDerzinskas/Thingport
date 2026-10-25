# Thingport backend changelog

# [thingport-backend-v1.3.0](https://github.com/TautvydasDerzinskas/Thingport/compare/thingport-backend-v1.2.0...thingport-backend-v1.3.0) (2026-10-25)


### Bug Fixes

* community widgets from develop on the dev image, no duplicate weather panel ([#138](https://github.com/TautvydasDerzinskas/Thingport/issues/138)) ([6b9a478](https://github.com/TautvydasDerzinskas/Thingport/commit/6b9a478035efd2874d6808eaac632df7e37c2b32))
* **images:** apply EXIF orientation on import ([9b541ad](https://github.com/TautvydasDerzinskas/Thingport/commit/9b541adf2a062163e73cf7292f2c79a826470e1e)), closes [#140](https://github.com/TautvydasDerzinskas/Thingport/issues/140)
* import zips whose entry paths start with ./ ([#128](https://github.com/TautvydasDerzinskas/Thingport/issues/128)) ([3161366](https://github.com/TautvydasDerzinskas/Thingport/commit/31613667849384dac9cc8c5bba31ea88ea27a5d6))
* match provider hosts on a dot boundary, so look-alike domains never get a user's cookie ([#150](https://github.com/TautvydasDerzinskas/Thingport/issues/150)) ([e67924e](https://github.com/TautvydasDerzinskas/Thingport/commit/e67924ee8c18493182c5e149e5306a1e6c8269f4))
* open files in OrcaSlicer without the session token in their name ([#134](https://github.com/TautvydasDerzinskas/Thingport/issues/134)) ([5d53af3](https://github.com/TautvydasDerzinskas/Thingport/commit/5d53af3c60ce4e3e87b6dc29a9088956d62e9d27))
* provider inconsistencies found by the provider contract tests ([#152](https://github.com/TautvydasDerzinskas/Thingport/issues/152)) ([9b5317d](https://github.com/TautvydasDerzinskas/Thingport/commit/9b5317d22626a921164c88b101a90ea55707cb34))
* read every valid Content-Disposition filename on link imports ([#129](https://github.com/TautvydasDerzinskas/Thingport/issues/129)) ([e2382f8](https://github.com/TautvydasDerzinskas/Thingport/commit/e2382f801d12767be57c692c877624f30625d063))
* run the file reuse code and its tests on macOS too ([#153](https://github.com/TautvydasDerzinskas/Thingport/issues/153)) ([ba46ff5](https://github.com/TautvydasDerzinskas/Thingport/commit/ba46ff58c3ac77e070e594a3892817d1dfe25246))


### Features

* add the Pinshape provider  ([#164](https://github.com/TautvydasDerzinskas/Thingport/issues/164)) ([7cd0bca](https://github.com/TautvydasDerzinskas/Thingport/commit/7cd0bca062de072c41c7dc46f916c0b9f7036af4))
* added bulk management for tags and improved bulk removal for collections ([8eea308](https://github.com/TautvydasDerzinskas/Thingport/commit/8eea30871ad33946796c0710034be1b397aeb459))
* dashboard remade (v3) + custom dashboard widget system ([#131](https://github.com/TautvydasDerzinskas/Thingport/issues/131)) ([0dfdae5](https://github.com/TautvydasDerzinskas/Thingport/commit/0dfdae545f946d65c6141363ea9303801752ad28))
* **extension:** add new features & improve ui ([#147](https://github.com/TautvydasDerzinskas/Thingport/issues/147)) ([6ebc65b](https://github.com/TautvydasDerzinskas/Thingport/commit/6ebc65b8c9e898ec8a1eb64b7e0bcf6fdc4642c2))
* go back over stored files when file reuse is turned on ([#143](https://github.com/TautvydasDerzinskas/Thingport/issues/143)) ([76130fa](https://github.com/TautvydasDerzinskas/Thingport/commit/76130fafb7e32c269bc9451c12c258408c15ecfb))
* keep browsers signed in ([#137](https://github.com/TautvydasDerzinskas/Thingport/issues/137)) ([6d13036](https://github.com/TautvydasDerzinskas/Thingport/commit/6d13036b83bb63e6aa1a6ede5fd49c7081368130))
* **mcp:** edit_model and tools to change a model's pictures, files and category ([#163](https://github.com/TautvydasDerzinskas/Thingport/issues/163)) ([c4abb24](https://github.com/TautvydasDerzinskas/Thingport/commit/c4abb24800efb2ea1af6e7e95c60b04eae18da8f))
* **mcp:** upload_model, list_model_files and get_model_file tools ([#162](https://github.com/TautvydasDerzinskas/Thingport/issues/162)) ([3464316](https://github.com/TautvydasDerzinskas/Thingport/commit/34643164644906077fc6c56212acc80d1baa0c05)), closes [#154](https://github.com/TautvydasDerzinskas/Thingport/issues/154)
* open models in any installed slicer and download from the same menu ([#133](https://github.com/TautvydasDerzinskas/Thingport/issues/133)) ([f2e71f6](https://github.com/TautvydasDerzinskas/Thingport/commit/f2e71f63c5353d639eafa3c2d2654d7e390a90c2))
* share identical model files between users via copy-on-write clones ([#132](https://github.com/TautvydasDerzinskas/Thingport/issues/132)) ([bc31127](https://github.com/TautvydasDerzinskas/Thingport/commit/bc31127f9dc7edb648dddcd5053a216e011625bc)), closes [#130](https://github.com/TautvydasDerzinskas/Thingport/issues/130)
* share identical supporting files and images between users ([#142](https://github.com/TautvydasDerzinskas/Thingport/issues/142)) ([e7df2f9](https://github.com/TautvydasDerzinskas/Thingport/commit/e7df2f9307403160590873566b5a799b72c816b0))

# [thingport-backend-v1.2.0](https://github.com/TautvydasDerzinskas/Thingport/compare/thingport-backend-v1.1.0...thingport-backend-v1.2.0) (2026-10-21)


### Bug Fixes

* address card preview review comments ([678c480](https://github.com/TautvydasDerzinskas/Thingport/commit/678c4802d74c16aee75f3f62ebee51cebd8f7037))
* announce each version once, and don't flash old notes on reopen ([58eb011](https://github.com/TautvydasDerzinskas/Thingport/commit/58eb01179346dd12d78ae8a23e4c27e3e255e681))
* check an imported model's description once its import is done ([6555875](https://github.com/TautvydasDerzinskas/Thingport/commit/6555875e29f7cfafc4b1a2db897a7cc59db626ff))
* count only MakerWorld profiles with an id before taking the raw files ([8affbbb](https://github.com/TautvydasDerzinskas/Thingport/commit/8affbbb6c3de73b9bafb505d4e8877832378c436))
* count suffixed renames, roll back failed theme saves, keep reset dialog open on error ([1a44b87](https://github.com/TautvydasDerzinskas/Thingport/commit/1a44b87cdc875fa92d23976eff44e48bb5dc727b))
* guard tag rewrites against concurrent edits, pluralise merge count, fix lt wording ([ef14f54](https://github.com/TautvydasDerzinskas/Thingport/commit/ef14f54221160dc416b8553f36aaab59d2dd7d47))
* harden mesh check against bad indices and tidy review follow-ups ([8b4653e](https://github.com/TautvydasDerzinskas/Thingport/commit/8b4653e415588b6cda7cae434052e4703f3abf7a))
* keep non-ASCII names readable in zip downloads ([060be2f](https://github.com/TautvydasDerzinskas/Thingport/commit/060be2f6920140dc005149b60f957accdd6831ac))
* keep skipped releases with curated notes, and show a failed copy ([60ee06b](https://github.com/TautvydasDerzinskas/Thingport/commit/60ee06ba438e266f545972870fc6c959b29cf05f))
* leave room for a reasoning model's thinking in the AI token budget ([5dc6ff6](https://github.com/TautvydasDerzinskas/Thingport/commit/5dc6ff67a3166fbe6aec2034c594d7b22262a9c2))
* list a nested pictures folder's files as its own model's ([67bea14](https://github.com/TautvydasDerzinskas/Thingport/commit/67bea149a92803472d30d5e1e4f64b77427b3071))
* **mcp:** rank list_tags by use and let it narrow, instead of every tag at once ([04e9719](https://github.com/TautvydasDerzinskas/Thingport/commit/04e97197d7ede73743c6692ad1317e437dfaa69b))
* retry a dashboard row's render when its url changes ([401cc38](https://github.com/TautvydasDerzinskas/Thingport/commit/401cc38461a9650b430998cf02aea4a11fdc34f7))
* touch only a model's own pictures, check picture files once, drop plate folders for other files ([ecc551e](https://github.com/TautvydasDerzinskas/Thingport/commit/ecc551ef2771e0d35be57face89547a3a5a54c23))


### Features

* add render colour, graphite accent and hover slideshow toggle ([926c5d3](https://github.com/TautvydasDerzinskas/Thingport/commit/926c5d345b9e52479cf083230fa9bc7839b97ca6))
* admin MCP access, token permissions dialog, and review fixes ([dec1b0d](https://github.com/TautvydasDerzinskas/Thingport/commit/dec1b0dbe3f8566a77bc981017ed29a0bbbc3703))
* **backend:** MCP endpoint at /api/mcp, with tools chosen per API token ([8567f19](https://github.com/TautvydasDerzinskas/Thingport/commit/8567f195c07254b48710fc7fd9f6679a25b2555f))
* **backend:** MCP tools that import models and file them into collections ([a36a996](https://github.com/TautvydasDerzinskas/Thingport/commit/a36a99639a1537d098f58e0555bf6af9da167550))
* check models for print problems when they are opened ([f913710](https://github.com/TautvydasDerzinskas/Thingport/commit/f913710cc4d1ad045b818b7fbff4d0a2cdeab9c3))
* import MakerWorld models that have only raw files ([437d85b](https://github.com/TautvydasDerzinskas/Thingport/commit/437d85be146d8a8c8fd04f7a626fc46605389a54))
* keep a model's pictures and supporting files beside its model files ([0d505b7](https://github.com/TautvydasDerzinskas/Thingport/commit/0d505b716a4cc496db0b3e5edcbf138bf5594da7))
* let a release update without notifying users ([aab83df](https://github.com/TautvydasDerzinskas/Thingport/commit/aab83df8861a1898d41a0c66c31a99069228d5e0))
* let users choose what their API token can read over the REST API ([88949d9](https://github.com/TautvydasDerzinskas/Thingport/commit/88949d9d8c8ab5ec575429d9bd6a8a4816acfaac))
* let users pick an accent color ([d26f730](https://github.com/TautvydasDerzinskas/Thingport/commit/d26f730bee0ec65597c68f97c0b05f327e673653))
* reset categories to the starter tree, previewing what changes ([f8424dc](https://github.com/TautvydasDerzinskas/Thingport/commit/f8424dcb2306c0bf2c3f4c4aa15f596594020ae6))
* show what's new after an update ([aebc0ac](https://github.com/TautvydasDerzinskas/Thingport/commit/aebc0ac97eddc75dfbb666a22efd6407070f810b))
* sort, bulk actions and merge for collections and tags ([a0dbba8](https://github.com/TautvydasDerzinskas/Thingport/commit/a0dbba80587d771eb37950c195e61f77b3a83c74))
* tint generated model renders with the accent ([908ae80](https://github.com/TautvydasDerzinskas/Thingport/commit/908ae80b5b6db48c645ab2be44b6e0a102447e0e))


### Performance Improvements

* **backend:** load a listing's files for the returned page only ([0da5db6](https://github.com/TautvydasDerzinskas/Thingport/commit/0da5db6536f11a6af03e8b05923204f47aaab0f9))

# [thingport-backend-v1.1.0](https://github.com/TautvydasDerzinskas/Thingport/compare/thingport-backend-v1.0.2...thingport-backend-v1.1.0) (2026-10-20)


### Bug Fixes

* add validation and improve error handling in sync operations ([7c3c7ec](https://github.com/TautvydasDerzinskas/Thingport/commit/7c3c7ec90298672150219ea18c44ac37bc40280c))
* correct category updates and improve NexPrint error handling ([1cf2903](https://github.com/TautvydasDerzinskas/Thingport/commit/1cf2903b8efd9e13f71b50e4e768f7930c1382eb))
* detect Cults3D clearance cookie in Cloudflare partitions ([2f66ed6](https://github.com/TautvydasDerzinskas/Thingport/commit/2f66ed682b1bc61b0a6c456db23aedbc15193eb1))
* handle malformed tokens, add refresh concurrency control, and improve list URL validation ([44f4bf2](https://github.com/TautvydasDerzinskas/Thingport/commit/44f4bf26354675ce41ee0c7e2684d3fe9384e70f))
* Makerworld profile thumbnails being all the same ([c6c8161](https://github.com/TautvydasDerzinskas/Thingport/commit/c6c8161a74dceca83d0827fec00735763ce76428))
* models with images should use them as thumbnails ([cf0653b](https://github.com/TautvydasDerzinskas/Thingport/commit/cf0653b005e9339a8cd0f200a7ef4a7e6f028f75))
* page a Thangs collection to the end without a total ([68a1481](https://github.com/TautvydasDerzinskas/Thingport/commit/68a14817079d8cc3bd275cfe4badf7bc16084194))
* **printService:** restore file on failed plate database update ([03fdd83](https://github.com/TautvydasDerzinskas/Thingport/commit/03fdd836a5889e9f06deea8d2311d69cae27efa1))
* tell print profiles apart by name and picture on every provider ([f34a488](https://github.com/TautvydasDerzinskas/Thingport/commit/f34a488fb21b69b50e8170105f5933f70cf46f01))


### Features

* add Cults3D provider ([930b9b4](https://github.com/TautvydasDerzinskas/Thingport/commit/930b9b48dba5c2375d4fccf2e59ced2965e87711))
* add MyMiniFactory as a provider ([a7a9190](https://github.com/TautvydasDerzinskas/Thingport/commit/a7a91902a0f43d47741e8cb52c1ec294f143fadb))
* add Thangs provider ([2591714](https://github.com/TautvydasDerzinskas/Thingport/commit/2591714c0cd44b086c0cb3c94d11e99c8262fe81))
* enable Creality Cloud provider ([772b1ac](https://github.com/TautvydasDerzinskas/Thingport/commit/772b1acfef609796015b51db186012e717124bc5))
* enable NextPrint provider ([4037151](https://github.com/TautvydasDerzinskas/Thingport/commit/4037151e4aaa6a744469b52ef60f999b343e085a))
* multi-select models in grids with bulk actions ([fe5dbec](https://github.com/TautvydasDerzinskas/Thingport/commit/fe5dbecdc5a76ab43eec39a5dd432626a9eaf2f6)), closes [#91](https://github.com/TautvydasDerzinskas/Thingport/issues/91)
* pick mapped provider categories by name ([87db3f0](https://github.com/TautvydasDerzinskas/Thingport/commit/87db3f0ff0346a2811ea4b4659056e9e5928df22))
* preview dashboard panels as tiles and add an activity heatmap panel ([c65e712](https://github.com/TautvydasDerzinskas/Thingport/commit/c65e712a31c30c0c0621c440a50a4e3f256dfb42))
* **providers:** enable MakerOnline provider ([5bf3457](https://github.com/TautvydasDerzinskas/Thingport/commit/5bf3457e8c5a5448c97f12fb0ac9101137884dca))
* **providers:** enable Snapmaker Space provider ([ac5bf25](https://github.com/TautvydasDerzinskas/Thingport/commit/ac5bf253c7c3a09abd0ce90e8c24539004f0f879))
* replace the AI Thinking toggle with a per-connection reasoning effort ([b30b0ce](https://github.com/TautvydasDerzinskas/Thingport/commit/b30b0cefd82691d391a9144d40efbd178ffbb331))

# [thingport-backend-v1.0.2](https://github.com/TautvydasDerzinskas/Thingport/compare/thingport-backend-v1.0.1...thingport-backend-v1.0.2) (2026-10-18)


### Bug Fixes

* download from Thingiverse with a Chrome TLS fingerprint ([8e6e5b2](https://github.com/TautvydasDerzinskas/Thingport/commit/8e6e5b2e0ee63b8d3c09bbbd3a086ad5543d2974))
* ensure Thingiverse gets browser agent ([40d36a4](https://github.com/TautvydasDerzinskas/Thingport/commit/40d36a4b20fc70133721f0ff60edf1240fa69030))

# [thingport-backend-v1.0.1](https://github.com/TautvydasDerzinskas/Thingport/compare/thingport-backend-v1.0.0...thingport-backend-v1.0.1) (2026-10-17)


### Bug Fixes

* rename Thingiverse Access Token to App Token to match what it provides ([cc41076](https://github.com/TautvydasDerzinskas/Thingport/commit/cc4107694aa0f35a234099a1fabaa840663cd29e))
* retry file downloads blocked by Cloudflare or rate limits ([b7c2f36](https://github.com/TautvydasDerzinskas/Thingport/commit/b7c2f36aced158b74072cb1f3507f4d83c58edf5))

# thingport-backend-v1.0.0 (2026-10-17)


### Bug Fixes

* 3mf model preview default to proper solid ([46b8687](https://github.com/TautvydasDerzinskas/Thingport/commit/46b8687d1d25c7b62307340b28108fe8966fa269))
* adjust downloads page ([58c773b](https://github.com/TautvydasDerzinskas/Thingport/commit/58c773b955131af5a4ae8e9c3d9ccc4255f23d8b))
* **ai:** disable categorization when last model is deleted ([bfc3fa0](https://github.com/TautvydasDerzinskas/Thingport/commit/bfc3fa0d72f86eeb508031a2457c9574a4421eca))
* **ai:** explain answers cut off by the token limit, and log AI and import runs ([#16](https://github.com/TautvydasDerzinskas/Thingport/issues/16)) ([7488793](https://github.com/TautvydasDerzinskas/Thingport/commit/748879311acebf47929bac613cce85ba4f0dc265))
* **ai:** show why a recategorization failed ([5fcadfb](https://github.com/TautvydasDerzinskas/Thingport/commit/5fcadfb179eeb8f40bb597a2826fa65f605ee256))
* allow replacing a model's only file in the edit dialog ([fc3f3ef](https://github.com/TautvydasDerzinskas/Thingport/commit/fc3f3efd48b9e926549773610e9d218780a28f21))
* big collection import printables ([8cb97bd](https://github.com/TautvydasDerzinskas/Thingport/commit/8cb97bd315a7a4a53c1879432679cdeb6f42bf71))
* correct multi-part 3MF previews and stop risky in-browser fallback ([65236c5](https://github.com/TautvydasDerzinskas/Thingport/commit/65236c5803b0624eced5fea069cd9594abeeeade))
* count queued links as models and let imported images replace 3D renders ([dd4d259](https://github.com/TautvydasDerzinskas/Thingport/commit/dd4d2592eae358357f71be13ac305d7219381d30))
* couple ux improvements ([030b155](https://github.com/TautvydasDerzinskas/Thingport/commit/030b1553e170b75c46766ee285dad21f0608e957))
* decode UTF-8 filenames delivered in the Latin-1 Content-Disposition header ([#3](https://github.com/TautvydasDerzinskas/Thingport/issues/3)) ([b732992](https://github.com/TautvydasDerzinskas/Thingport/commit/b73299222a3c086d6663bc2c59a7b7f0902ac755))
* derive the 3D preview memory budget from available memory ([5685514](https://github.com/TautvydasDerzinskas/Thingport/commit/5685514da632c4aa407d8e79d5f0ffddac479815))
* distinguish Thingiverse rate limits from auth errors and add AI run logging ([c5e5ab4](https://github.com/TautvydasDerzinskas/Thingport/commit/c5e5ab460e336e2b4eb071f8928d77b96cc36ea4))
* **extension:** check a MakerWorld collection against the library in one call ([44c687b](https://github.com/TautvydasDerzinskas/Thingport/commit/44c687b3ae7ba96a7246ece73d79212733cfd449))
* file upload file name utf8 issues ([6d34243](https://github.com/TautvydasDerzinskas/Thingport/commit/6d34243b89fe5f4e08f1fe9cc1fcb784d55d447d))
* import issues ([0d1efdb](https://github.com/TautvydasDerzinskas/Thingport/commit/0d1efdba02149f00ac3d0aca279cbe35e7b1e97e))
* importing models due preview generation uses all resources ([355833c](https://github.com/TautvydasDerzinskas/Thingport/commit/355833ca240865bf89684c4cb4bf05eb4648ddc6))
* **import:** limit manual CAPTCHA cooloff lifts to one per 5 minutes, require value on captcha keys ([bf083bc](https://github.com/TautvydasDerzinskas/Thingport/commit/bf083bcb26d2d49cafdc270523a210a15ad918da))
* **import:** stop flagging models that mention robots as a MakerWorld CAPTCHA, and let a manual retry try again ([#18](https://github.com/TautvydasDerzinskas/Thingport/issues/18)) ([d70dcfe](https://github.com/TautvydasDerzinskas/Thingport/commit/d70dcfeac2c788686728598c6d3c61b9f4cce369))
* improve bookmarks ui ([01f8812](https://github.com/TautvydasDerzinskas/Thingport/commit/01f8812cef9abf45824038d735eed6d9b2d9f731))
* include MakerWorld gallery images when importing from the model page ([e87eb39](https://github.com/TautvydasDerzinskas/Thingport/commit/e87eb39ab6aa0cb8f8ea465c0407f0ae8c71b6e0))
* make link-authors test deterministic ([9ada95b](https://github.com/TautvydasDerzinskas/Thingport/commit/9ada95b0a23fc949de3a57f413f423edddfd587a))
* make storage template collection and creator tokens reflect real data ([32710f2](https://github.com/TautvydasDerzinskas/Thingport/commit/32710f25e7b1011b9dc85bbbb67d403f6381a14a))
* make sure authors are removed when no models assigned to them ([55f5aaa](https://github.com/TautvydasDerzinskas/Thingport/commit/55f5aaa4a0473e23f87933f2347e7ef1bd75bb45))
* maker world importing ([476895f](https://github.com/TautvydasDerzinskas/Thingport/commit/476895f72f2d5327b1b193d8bfb7eddb4bb3c38e))
* MakerWorld author to print linking ([60eb0b9](https://github.com/TautvydasDerzinskas/Thingport/commit/60eb0b90feb2fefb1296a07a792ca0965a1e39ba))
* Makerworld import issues + allowing import different profiles ([303ab91](https://github.com/TautvydasDerzinskas/Thingport/commit/303ab918ea9b1f2d6866baf89f11b601364a1a36))
* minor adjustments in regards of import redirects and authors ([f187b9f](https://github.com/TautvydasDerzinskas/Thingport/commit/f187b9f25ec2cadf12ca03430c601ec0077b27bc))
* minor fixes along admin ([75de79c](https://github.com/TautvydasDerzinskas/Thingport/commit/75de79c4bcf6cc30bd79739bc8ff729718088244))
* minor fixes in UI ([f93bfc7](https://github.com/TautvydasDerzinskas/Thingport/commit/f93bfc7db4de24d07d03d30cfa51d988a87f76da))
* more than 11 models printables import ([27948c0](https://github.com/TautvydasDerzinskas/Thingport/commit/27948c01eef2202d851098f82972194c67f47d63))
* move preview generation to own separate thread ([ba08d30](https://github.com/TautvydasDerzinskas/Thingport/commit/ba08d30e1ee5685c67260886d4edb87e82332e1d))
* profile menu chips ([f903abc](https://github.com/TautvydasDerzinskas/Thingport/commit/f903abcd293b77adce74f0d786b6fa462ff4ef3b))
* show a proper error message when MakerWorld cookie fails due flareSolverr ([a81765e](https://github.com/TautvydasDerzinskas/Thingport/commit/a81765e1caff377ef442d3202ecebb6b566ebf92))
* skip a stale MakerWorld defaultInstanceId when picking the print profile ([#15](https://github.com/TautvydasDerzinskas/Thingport/issues/15)) ([d5ae809](https://github.com/TautvydasDerzinskas/Thingport/commit/d5ae80951cf69a9a4db118eee4f68d332f0af17a)), closes [#14](https://github.com/TautvydasDerzinskas/Thingport/issues/14)
* update Makerworld import logic ([3bc4f9c](https://github.com/TautvydasDerzinskas/Thingport/commit/3bc4f9c96dfe0b07de83d3fbff113efb3d14a2a1))
* various small UI issues ([8ba368e](https://github.com/TautvydasDerzinskas/Thingport/commit/8ba368e209c7d56e4ee48e5bf042e777f19d5b0a))


### Features

* ability to link multiple AIs ([56f173a](https://github.com/TautvydasDerzinskas/Thingport/commit/56f173a20b574014f5a29c6c8bbcc38f71c3dda8))
* accept MakerWorld page data sent with an extension import ([616a8b8](https://github.com/TautvydasDerzinskas/Thingport/commit/616a8b82c3657727b80da1fa924f35a32ca46d38))
* add ability to enable catpcha ([6a6a87e](https://github.com/TautvydasDerzinskas/Thingport/commit/6a6a87e38d8a8b65edf137171dfb6ff15dde3976))
* add admin job to refetch all user descriptions ([0cc27c9](https://github.com/TautvydasDerzinskas/Thingport/commit/0cc27c9eb618154c477dac5bd9cb1361eb7d291c))
* add Anycubic Slicer Next, Elegoo Slicer and Snapmaker Orca slicer options ([9dd3e69](https://github.com/TautvydasDerzinskas/Thingport/commit/9dd3e693e09efadb958b7ed31713310aad99f9c8))
* add author hover popover preview card ([864ec1c](https://github.com/TautvydasDerzinskas/Thingport/commit/864ec1cacdcf85a2f49a3ac64054178739ee36c5))
* add author linking admin trigger ([2a3434f](https://github.com/TautvydasDerzinskas/Thingport/commit/2a3434f126a92eb44e4ee633394146e8942f2a9a))
* add author page ([45b6bac](https://github.com/TautvydasDerzinskas/Thingport/commit/45b6bac574c69e376f982c18c71f7a3306176cd0))
* add captcha options for changing password and email ([21f91d6](https://github.com/TautvydasDerzinskas/Thingport/commit/21f91d62758e894488a18663adecc998f1a207a6))
* add collections ([b5568d3](https://github.com/TautvydasDerzinskas/Thingport/commit/b5568d35e61734f18504ddf697a8a78bf5521da6))
* add consume folder support ([e22f579](https://github.com/TautvydasDerzinskas/Thingport/commit/e22f57903f3c3f564e92a085eef99c4877127723))
* add first version of search ([83e0beb](https://github.com/TautvydasDerzinskas/Thingport/commit/83e0bebf45836017c3181b7ded881153b7e84451))
* add flaresolverr ([d8c2ef2](https://github.com/TautvydasDerzinskas/Thingport/commit/d8c2ef20ffe226df89c2a5bc64124d73aa5c17ec))
* add proper auth ([be45bac](https://github.com/TautvydasDerzinskas/Thingport/commit/be45bacbea7e313253c4cccc0a3dc633ad3b2876))
* add rich text formatting toolbar to model descriptions ([d49d7c9](https://github.com/TautvydasDerzinskas/Thingport/commit/d49d7c99196633d85b7ae3d375edd5f45e919829))
* add sanitized bambu 3mf open option ([0d8cd62](https://github.com/TautvydasDerzinskas/Thingport/commit/0d8cd62fa7837875591cad5bd58bd968bd7862e1))
* add setting to customize dashboard model thumbnail appearance ([163d73f](https://github.com/TautvydasDerzinskas/Thingport/commit/163d73f2a79b6e1a5c3721b996aef7c8310c93bf))
* add sorting and ect ([312c6be](https://github.com/TautvydasDerzinskas/Thingport/commit/312c6be706ec3f49356f71cb933bc78d0d64b71e))
* add tags route ([6990c2f](https://github.com/TautvydasDerzinskas/Thingport/commit/6990c2ff9f200ebd27c4deaafd47e0c3867b849c))
* add to collections modals ([1d8443e](https://github.com/TautvydasDerzinskas/Thingport/commit/1d8443e069a3bce13692f1d64cd071f8c6edf46c))
* add users activity page ([6533781](https://github.com/TautvydasDerzinskas/Thingport/commit/6533781a2141e720e953089a5fd55c2ddc5c4685))
* admin panel remake ([2bce5a2](https://github.com/TautvydasDerzinskas/Thingport/commit/2bce5a20497e8523f9d73fba83e30c3cb2f1917f))
* admin sidebar change and system health check view ([#48](https://github.com/TautvydasDerzinskas/Thingport/issues/48)) ([92161f8](https://github.com/TautvydasDerzinskas/Thingport/commit/92161f8cf801ea57ac229cf91e07190417e7b216))
* administration settings remake + OIDC support ([#49](https://github.com/TautvydasDerzinskas/Thingport/issues/49)) ([9a22386](https://github.com/TautvydasDerzinskas/Thingport/commit/9a2238691d8b079adf7bfb4becebc9cf01cb6cad))
* **admin:** manage user roles and delete users, with an instance owner ([9d41c4d](https://github.com/TautvydasDerzinskas/Thingport/commit/9d41c4dee3333677b964d2d0baede8ce45d5aa45))
* AI features split, categorisation UX updates ([e542cc4](https://github.com/TautvydasDerzinskas/Thingport/commit/e542cc4473cb57ad5281b06d15518e10ade8f843))
* **ai:** accept the provider base URL with or without /v1 ([29c54ba](https://github.com/TautvydasDerzinskas/Thingport/commit/29c54bac117077e9ee2dabed068baf6dfb56386b))
* **AI:** add improved descriptions ([97f17e4](https://github.com/TautvydasDerzinskas/Thingport/commit/97f17e4fa35aa03db4ce8ac17b8419100efc333c))
* allow bookmarking collections ([4f40803](https://github.com/TautvydasDerzinskas/Thingport/commit/4f408031b43d97e7040df21ddbbf259bfce65456))
* allow disabling registrations + invitation system ([91ffbf5](https://github.com/TautvydasDerzinskas/Thingport/commit/91ffbf5441dec0bedde4fd901c1bdca18a2b7267))
* allow downloading collection and tag models in bulk ([d3c651c](https://github.com/TautvydasDerzinskas/Thingport/commit/d3c651c05d2fa0e16f55546189cd5965997fd216))
* allow import thingiverse likes & collections ([ac32d03](https://github.com/TautvydasDerzinskas/Thingport/commit/ac32d03071d139ec4a8bdaed0017686cd68d700f))
* allow multiple meta category ids ([8450885](https://github.com/TautvydasDerzinskas/Thingport/commit/8450885ea19df6e505c6b3d5c0f3f061c462b09a))
* allow open in Cura slicer ([e84fbca](https://github.com/TautvydasDerzinskas/Thingport/commit/e84fbca5f9bfc2040c86cb07ffe421c75bffd212))
* allow toggling off author previews per user ([711ece0](https://github.com/TautvydasDerzinskas/Thingport/commit/711ece0f62bff1c93f951024f5f98bac582e7dd2))
* anable complex model simplification ([7464583](https://github.com/TautvydasDerzinskas/Thingport/commit/746458378052fa228465261cceca1a71dea58c34))
* **api-tokens:** add per-user API tokens with generation and revocation ([469641d](https://github.com/TautvydasDerzinskas/Thingport/commit/469641de181b76bf463357548fa314b777ab1f4d))
* **auth:** add password reset flow ([3a05fae](https://github.com/TautvydasDerzinskas/Thingport/commit/3a05fae555d3a553196487930f636ade4f9348e8))
* author linking and other minor author changes ([589a5f4](https://github.com/TautvydasDerzinskas/Thingport/commit/589a5f464abdd675afe1ef8f63fe2ed843823043))
* browse private collections functionality ([b619084](https://github.com/TautvydasDerzinskas/Thingport/commit/b619084be7ed060d02cd6ba473a196e7ba0859de))
* bulk feature changes ([7d18539](https://github.com/TautvydasDerzinskas/Thingport/commit/7d185395a355f327472652a054ba4a6a01800ba6))
* **categories:** add toggle between categories and folders ([33400fa](https://github.com/TautvydasDerzinskas/Thingport/commit/33400fa12803e1e7588a13fb200061b916062b80))
* **categories:** allow moving subcategories between parent categories ([172270f](https://github.com/TautvydasDerzinskas/Thingport/commit/172270fce81f4f713b295bde33e3bd853fcbc582))
* **categories:** allow unlimited depth of categories ([04f3106](https://github.com/TautvydasDerzinskas/Thingport/commit/04f3106ce84f94c92a08b42fa2546c4e050c1f98))
* categorize models with an OpenAI-compatible AI provider ([#11](https://github.com/TautvydasDerzinskas/Thingport/issues/11)) ([708a938](https://github.com/TautvydasDerzinskas/Thingport/commit/708a93822a40a69249232f52de8296006c33b7ae))
* chrome estensions Thingport grab ([7d53efb](https://github.com/TautvydasDerzinskas/Thingport/commit/7d53efb785469248b7d3be20fbf5af499a062090))
* collection impoort ([031cdf3](https://github.com/TautvydasDerzinskas/Thingport/commit/031cdf39902e212e24e0cb74d3cdbb8e7450a3a6))
* collection import pt2 ([f04ca0c](https://github.com/TautvydasDerzinskas/Thingport/commit/f04ca0c8b80bbc995084309c463896ffc32c7997))
* **collection-sync:** allow syncing collections with provider collections ([ef9152d](https://github.com/TautvydasDerzinskas/Thingport/commit/ef9152df6cd0edee4fff8355434c9e2e09f73731)), closes [#10](https://github.com/TautvydasDerzinskas/Thingport/issues/10)
* **collections:** add many models to a collection in one call ([acfa844](https://github.com/TautvydasDerzinskas/Thingport/commit/acfa844ebe62ee635941a2a6d499083cf4856d47))
* **collections:** turn sync on from Thingport, picking the provider's collection ([1131700](https://github.com/TautvydasDerzinskas/Thingport/commit/1131700ec5eb53801a85c842143717c66696d8d8))
* dashboard implementation ([cf5c8a9](https://github.com/TautvydasDerzinskas/Thingport/commit/cf5c8a958462bb0193379966696aa11935d72d1b))
* **dashboard:** add clock, weather, and featured-model widgets ([c71154a](https://github.com/TautvydasDerzinskas/Thingport/commit/c71154a83eb897122488a7c619cf38732eb4be44))
* **dashboard:** make dashboard panes toggleable ([3d1c851](https://github.com/TautvydasDerzinskas/Thingport/commit/3d1c851ad7baa007f883499d310c438f97c2b264))
* default categories for new users ([cefc27f](https://github.com/TautvydasDerzinskas/Thingport/commit/cefc27f23fd25e9693bcdc0f43b3e1b9c11f646c))
* edit model functionality ([37ac318](https://github.com/TautvydasDerzinskas/Thingport/commit/37ac318e40dff826d6081657cb59e4f3c30a4b5e))
* enable back flaresolverr ([ead9751](https://github.com/TautvydasDerzinskas/Thingport/commit/ead97510d4f4b39109e74f8921bc2b1fceb4dca3))
* extend dashboard settings with layouts ([2813237](https://github.com/TautvydasDerzinskas/Thingport/commit/2813237e037c9559b2d4beb161afffed5628c4b0))
* **extension:** improve loading messaging + make queue admin-only ([67a31cc](https://github.com/TautvydasDerzinskas/Thingport/commit/67a31cc94052fda9faf1daf831b6fbf5ce7b53e9))
* **flaresolverr:** make URL configurable in admin settings ([5fa6c40](https://github.com/TautvydasDerzinskas/Thingport/commit/5fa6c403247e497c0dece4e8e3e1d28d1e25b484))
* handle download limit error gracefully ([fd7c26a](https://github.com/TautvydasDerzinskas/Thingport/commit/fd7c26a760b82142b8be74634f1461e2007d5ab1))
* import all designer or all MakerWorld print profiles of a model ([101aa03](https://github.com/TautvydasDerzinskas/Thingport/commit/101aa03f9c7526287847afd60d8733dfb0125db5))
* import author details from makerworld ([b16c27b](https://github.com/TautvydasDerzinskas/Thingport/commit/b16c27bc1e4f107598824814a406043478ec609f))
* improve model details page ([d5db3d3](https://github.com/TautvydasDerzinskas/Thingport/commit/d5db3d3b18ca7844f4b2abda687b78757d8c0302))
* improve model details page ([05fae4c](https://github.com/TautvydasDerzinskas/Thingport/commit/05fae4c93fe9e466d3443f2a909df8c9298b7ee0))
* increase MakerWorld pacing ([fa75ae1](https://github.com/TautvydasDerzinskas/Thingport/commit/fa75ae1219334c98c675665ae5010d7c93cf176c))
* initial commit ([a8fef7d](https://github.com/TautvydasDerzinskas/Thingport/commit/a8fef7d4913d1096beaabc4cd78b9c3a6b7d3c86))
* link import queue with an admin page and send-to-queue in the extension, plus update from source ([#6](https://github.com/TautvydasDerzinskas/Thingport/issues/6)) ([96da36a](https://github.com/TautvydasDerzinskas/Thingport/commit/96da36ae7999ab5c91bf076a727922a0dbdad0ec))
* make print count be more interactive ([8e4f7dd](https://github.com/TautvydasDerzinskas/Thingport/commit/8e4f7ddf47de719b4da95753e1741e97f5de353c))
* make sure thingiverse token is verified ([9d07db9](https://github.com/TautvydasDerzinskas/Thingport/commit/9d07db9dc9c9cc3ef468ebdac96b9e2affe3132e))
* make ttl configurable in admin ([6c66e7b](https://github.com/TautvydasDerzinskas/Thingport/commit/6c66e7b615e4ebb8d18feea00330636b533fdad7))
* **notifications:** reinvent notifications ([1408b09](https://github.com/TautvydasDerzinskas/Thingport/commit/1408b09c5989499b38ee0effd1b7c29661a233a5))
* pause guided MakerWorld imports on a CAPTCHA, and fix localized and long collection imports ([627a442](https://github.com/TautvydasDerzinskas/Thingport/commit/627a442d53a709f41e42bc508af7305aca5578a1))
* printables importing ([47a0ddd](https://github.com/TautvydasDerzinskas/Thingport/commit/47a0dddf9337e2624505bc2acf3be5e6e9b1033a))
* rebrand from PrintStash to Thingport ([56de86d](https://github.com/TautvydasDerzinskas/Thingport/commit/56de86d5b5367fe593587bee73c1ca730e356ae5))
* **search:** add ability to load search active views ([90a9942](https://github.com/TautvydasDerzinskas/Thingport/commit/90a9942d1b9966bdcf0558e8d5b986af79a625bf))
* **search:** add option to see all results ([ad27e95](https://github.com/TautvydasDerzinskas/Thingport/commit/ad27e950a9048a4e50ab67196fbd42d61db86f89))
* show available models in model input ([8718d82](https://github.com/TautvydasDerzinskas/Thingport/commit/8718d82ab3b4afe0565e0d0a8dddb6de540493fc))
* show model usage in memory size ([2813d47](https://github.com/TautvydasDerzinskas/Thingport/commit/2813d47049817697e3c74ba0db82217c2912111d))
* support Markdown with embedded images in model descriptions ([97f0eea](https://github.com/TautvydasDerzinskas/Thingport/commit/97f0eea4c267612c8b78546d43129550dfac4dc8))
* **sync:** notify on enable, change defaults to daily and designer profiles ([9334438](https://github.com/TautvydasDerzinskas/Thingport/commit/9334438a521a2a5f9a39f6af4d892ac2465c02ce))
* **sync:** pause syncs while a provider isn't connected, and hand back models blocked by it ([6993a4c](https://github.com/TautvydasDerzinskas/Thingport/commit/6993a4c4231b9e80db9eb13c27ab97fc89e9ac01))
* system notifications updates, Thingport grab in System health check, node 24+ ([#52](https://github.com/TautvydasDerzinskas/Thingport/issues/52)) ([358dfc1](https://github.com/TautvydasDerzinskas/Thingport/commit/358dfc1a03a178115642d41423f40586cd879b90))
* **tags:** add pagination, thumbnails, and tag deletion ([cdf0a53](https://github.com/TautvydasDerzinskas/Thingport/commit/cdf0a53251e1ef6d507b15735ad3cae7406b00de))
* various major UI & UX improvements ([7b1f718](https://github.com/TautvydasDerzinskas/Thingport/commit/7b1f718c74485b79c9117469ff35aa4c661f6829))


### Performance Improvements

* **tags:** render tag mosaics on the server and size pages to the screen ([eefbde1](https://github.com/TautvydasDerzinskas/Thingport/commit/eefbde1bb5c64bd0860e2613a79e768a0f0e6891))
