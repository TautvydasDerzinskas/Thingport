# Thingport Grab changelog

# [thingport-grab-v1.8.1](https://github.com/TautvydasDerzinskas/Thingport/compare/thingport-grab-v1.8.0...thingport-grab-v1.8.1) (2026-10-25)


### Bug Fixes

* **extension,backend:** use eufyMake's sign-in now the site base64s mk-userinfo ([#170](https://github.com/TautvydasDerzinskas/Thingport/issues/170)) ([d8d095c](https://github.com/TautvydasDerzinskas/Thingport/commit/d8d095c3b32427f7268e2b7e6ac3b4d5cbefdb9f))

# [thingport-grab-v1.8.0](https://github.com/TautvydasDerzinskas/Thingport/compare/thingport-grab-v1.7.0...thingport-grab-v1.8.0) (2026-10-25)


### Bug Fixes

* **extension:** list sync storage and Snapmaker renewal in Edge notes ([f240dce](https://github.com/TautvydasDerzinskas/Thingport/commit/f240dce392c96f57749f32dafe3ee0165a6f6f26))
* **extension:** narrow the data claim in Edge certification notes ([900731f](https://github.com/TautvydasDerzinskas/Thingport/commit/900731fbd943404c9ea4f088e60282d480d5a3c2))
* match provider hosts on a dot boundary, so look-alike domains never get a user's cookie ([#150](https://github.com/TautvydasDerzinskas/Thingport/issues/150)) ([e67924e](https://github.com/TautvydasDerzinskas/Thingport/commit/e67924ee8c18493182c5e149e5306a1e6c8269f4))
* prevent AMO rate limit errors in extension release ([d33802d](https://github.com/TautvydasDerzinskas/Thingport/commit/d33802d8c0706068d1f6fee8e34689be4e913cca))


### Features

* add the Pinshape provider  ([#164](https://github.com/TautvydasDerzinskas/Thingport/issues/164)) ([7cd0bca](https://github.com/TautvydasDerzinskas/Thingport/commit/7cd0bca062de072c41c7dc46f916c0b9f7036af4))
* **extension:** add new features & improve ui ([#147](https://github.com/TautvydasDerzinskas/Thingport/issues/147)) ([6ebc65b](https://github.com/TautvydasDerzinskas/Thingport/commit/6ebc65b8c9e898ec8a1eb64b7e0bcf6fdc4642c2))

# [thingport-grab-v1.7.0](https://github.com/TautvydasDerzinskas/Thingport/compare/thingport-grab-v1.6.0...thingport-grab-v1.7.0) (2026-10-20)


### Bug Fixes

* add validation and improve error handling in sync operations ([7c3c7ec](https://github.com/TautvydasDerzinskas/Thingport/commit/7c3c7ec90298672150219ea18c44ac37bc40280c))
* correct category updates and improve NexPrint error handling ([1cf2903](https://github.com/TautvydasDerzinskas/Thingport/commit/1cf2903b8efd9e13f71b50e4e768f7930c1382eb))
* detect Cults3D clearance cookie in Cloudflare partitions ([2f66ed6](https://github.com/TautvydasDerzinskas/Thingport/commit/2f66ed682b1bc61b0a6c456db23aedbc15193eb1))
* handle malformed tokens, add refresh concurrency control, and improve list URL validation ([44f4bf2](https://github.com/TautvydasDerzinskas/Thingport/commit/44f4bf26354675ce41ee0c7e2684d3fe9384e70f))
* Makerworld profile thumbnails being all the same ([c6c8161](https://github.com/TautvydasDerzinskas/Thingport/commit/c6c8161a74dceca83d0827fec00735763ce76428))
* tell print profiles apart by name and picture on every provider ([f34a488](https://github.com/TautvydasDerzinskas/Thingport/commit/f34a488fb21b69b50e8170105f5933f70cf46f01))


### Features

* add Cults3D provider ([930b9b4](https://github.com/TautvydasDerzinskas/Thingport/commit/930b9b48dba5c2375d4fccf2e59ced2965e87711))
* add MyMiniFactory as a provider ([a7a9190](https://github.com/TautvydasDerzinskas/Thingport/commit/a7a91902a0f43d47741e8cb52c1ec294f143fadb))
* add Thangs provider ([2591714](https://github.com/TautvydasDerzinskas/Thingport/commit/2591714c0cd44b086c0cb3c94d11e99c8262fe81))
* enable Creality Cloud provider ([772b1ac](https://github.com/TautvydasDerzinskas/Thingport/commit/772b1acfef609796015b51db186012e717124bc5))
* enable NextPrint provider ([4037151](https://github.com/TautvydasDerzinskas/Thingport/commit/4037151e4aaa6a744469b52ef60f999b343e085a))
* **providers:** enable MakerOnline provider ([5bf3457](https://github.com/TautvydasDerzinskas/Thingport/commit/5bf3457e8c5a5448c97f12fb0ac9101137884dca))
* **providers:** enable Snapmaker Space provider ([ac5bf25](https://github.com/TautvydasDerzinskas/Thingport/commit/ac5bf253c7c3a09abd0ce90e8c24539004f0f879))

# [thingport-grab-v1.6.0](https://github.com/TautvydasDerzinskas/Thingport/compare/thingport-grab-v1.5.0...thingport-grab-v1.6.0) (2026-10-17)


### Bug Fixes

* **import:** stop flagging models that mention robots as a MakerWorld CAPTCHA, and let a manual retry try again ([#18](https://github.com/TautvydasDerzinskas/Thingport/issues/18)) ([d70dcfe](https://github.com/TautvydasDerzinskas/Thingport/commit/d70dcfeac2c788686728598c6d3c61b9f4cce369))
* skip a stale MakerWorld defaultInstanceId when picking the print profile ([#15](https://github.com/TautvydasDerzinskas/Thingport/issues/15)) ([d5ae809](https://github.com/TautvydasDerzinskas/Thingport/commit/d5ae80951cf69a9a4db118eee4f68d332f0af17a)), closes [#14](https://github.com/TautvydasDerzinskas/Thingport/issues/14)


### Features

* administration settings remake + OIDC support ([#49](https://github.com/TautvydasDerzinskas/Thingport/issues/49)) ([9a22386](https://github.com/TautvydasDerzinskas/Thingport/commit/9a2238691d8b079adf7bfb4becebc9cf01cb6cad))
* system notifications updates, Thingport grab in System health check, node 24+ ([#52](https://github.com/TautvydasDerzinskas/Thingport/issues/52)) ([358dfc1](https://github.com/TautvydasDerzinskas/Thingport/commit/358dfc1a03a178115642d41423f40586cd879b90))

# [thingport-grab-v1.5.0](https://github.com/TautvydasDerzinskas/Thingport/compare/thingport-grab-v1.4.0...thingport-grab-v1.5.0) (2026-10-12)


### Bug Fixes

* **extension:** check a MakerWorld collection against the library in one call ([44c687b](https://github.com/TautvydasDerzinskas/Thingport/commit/44c687b3ae7ba96a7246ece73d79212733cfd449))


### Features

* browse private collections functionality ([b619084](https://github.com/TautvydasDerzinskas/Thingport/commit/b619084be7ed060d02cd6ba473a196e7ba0859de))
* **collections:** add many models to a collection in one call ([acfa844](https://github.com/TautvydasDerzinskas/Thingport/commit/acfa844ebe62ee635941a2a6d499083cf4856d47))
* **collections:** turn sync on from Thingport, picking the provider's collection ([1131700](https://github.com/TautvydasDerzinskas/Thingport/commit/1131700ec5eb53801a85c842143717c66696d8d8))
* **extension:** show when Thingport Grab can't sign in ([623cf25](https://github.com/TautvydasDerzinskas/Thingport/commit/623cf25f2c43d153b6e89952ab572923558aa6b7))
* **extension:** tell Thingport who you're signed in as on Printables and Thingiverse ([d3ed673](https://github.com/TautvydasDerzinskas/Thingport/commit/d3ed67342aae85bc170b95b01b7aba9dfcab15e0))
* **notifications:** reinvent notifications ([1408b09](https://github.com/TautvydasDerzinskas/Thingport/commit/1408b09c5989499b38ee0effd1b7c29661a233a5))
* **sync:** notify on enable, change defaults to daily and designer profiles ([9334438](https://github.com/TautvydasDerzinskas/Thingport/commit/9334438a521a2a5f9a39f6af4d892ac2465c02ce))

# [thingport-grab-v1.4.0](https://github.com/TautvydasDerzinskas/Thingport/compare/thingport-grab-v1.3.0...thingport-grab-v1.4.0) (2026-10-08)


### Bug Fixes

* **extension:** store imports in shared storage ([84b4f5b](https://github.com/TautvydasDerzinskas/Thingport/commit/84b4f5bd141e2187cbfe980f7cfc9925829fd467))
* **extension:** use template for Edge certification notes ([30be8c4](https://github.com/TautvydasDerzinskas/Thingport/commit/30be8c434901438225f4a3fd15ed63c222ce4173))


### Features

* **collection-sync:** allow syncing collections with provider collections ([ef9152d](https://github.com/TautvydasDerzinskas/Thingport/commit/ef9152df6cd0edee4fff8355434c9e2e09f73731)), closes [#10](https://github.com/TautvydasDerzinskas/Thingport/issues/10)
* handle download limit error gracefully ([fd7c26a](https://github.com/TautvydasDerzinskas/Thingport/commit/fd7c26a760b82142b8be74634f1461e2007d5ab1))

# [thingport-grab-v1.3.0](https://github.com/TautvydasDerzinskas/Thingport/compare/thingport-grab-v1.2.0...thingport-grab-v1.3.0) (2026-10-05)


### Features

* **extension:** add loading state phrases for different operations ([0325f16](https://github.com/TautvydasDerzinskas/Thingport/commit/0325f16c8527bea78343f91f386c0c0a0d61d02a))
* **extension:** allow importing to new custom collections ([a5ac824](https://github.com/TautvydasDerzinskas/Thingport/commit/a5ac82411079f395db9bcf9f951b7c1df9f096c8))
* **extension:** improve loading messaging + make queue admin-only ([67a31cc](https://github.com/TautvydasDerzinskas/Thingport/commit/67a31cc94052fda9faf1daf831b6fbf5ce7b53e9))
* link import queue with an admin page and send-to-queue in the extension, plus update from source ([#6](https://github.com/TautvydasDerzinskas/Thingport/issues/6)) ([96da36a](https://github.com/TautvydasDerzinskas/Thingport/commit/96da36ae7999ab5c91bf076a727922a0dbdad0ec))
* pause guided MakerWorld imports on a CAPTCHA, and fix localized and long collection imports ([627a442](https://github.com/TautvydasDerzinskas/Thingport/commit/627a442d53a709f41e42bc508af7305aca5578a1))

# [thingport-grab-v1.2.0](https://github.com/TautvydasDerzinskas/Thingport/compare/thingport-grab-v1.1.2...thingport-grab-v1.2.0) (2026-10-01)


### Bug Fixes

* **extension:** drop unneeded tabs permission ([9549148](https://github.com/TautvydasDerzinskas/Thingport/commit/9549148dfd38e642e7374f4e21748360cb73b9e6))
* **extension:** include captcha related header ([7d51458](https://github.com/TautvydasDerzinskas/Thingport/commit/7d5145898862f4220a77cb277973489bd2863cd0))
* **extension:** send devmodelname and match makerworld button design ([955513c](https://github.com/TautvydasDerzinskas/Thingport/commit/955513c5c52e63294f15d1e6816c3ca6063d3114))
* **extension:** show print profile choices after navigating within MakerWorld ([484efff](https://github.com/TautvydasDerzinskas/Thingport/commit/484efff1c956b7cc1967cbb4699bab78955b40e2))


### Features

* **extension:** add normalized download for MakerWorld ([2380c56](https://github.com/TautvydasDerzinskas/Thingport/commit/2380c566e54cd9ba0225689cf58f2899597a15d7))
* **extension:** automate publishing to Chrome Web Store ([e37073c](https://github.com/TautvydasDerzinskas/Thingport/commit/e37073cf531e55c15f917cf44e6595dc29d661af))
* **extension:** choose which MakerWorld print profiles to import ([fc612b3](https://github.com/TautvydasDerzinskas/Thingport/commit/fc612b30c0dd7e8fe6df1801d67e790e420ac1c8))
* **extension:** send MakerWorld page data with imports ([c3a189e](https://github.com/TautvydasDerzinskas/Thingport/commit/c3a189ea7fdba849c257b05c1dc16f95a3a83a2f))
