## [1.1.0](https://github.com/ExaDev/process-graph/compare/@exadev/process-graph-projection@1.0.3...@exadev/process-graph-projection@1.1.0) (2026-10-11)

### Features

* **projection:** derive sequence fragments and read message elements ([aa48737](https://github.com/ExaDev/process-graph/commit/aa48737ebc2fc5ace6c099bd6cc1441cf534df32))
* **projection:** turn an edited view back into a diff against the model ([0c509a1](https://github.com/ExaDev/process-graph/commit/0c509a14f948c6d2597c5e4c57beb3b194953c31))

### Bug Fixes

* **projection:** act on the steps into each shared end once in the inverses ([6e30bb5](https://github.com/ExaDev/process-graph/commit/6e30bb5c21e617faab90c7880c4c4cd2060055cb))
* **projection:** build flat target arrays only where they are read ([79f6ee2](https://github.com/ExaDev/process-graph/commit/79f6ee297637c8a6a56825cac2a00434a764164d))
* **projection:** check whether a nested fragment fits in constant or log time ([03829a1](https://github.com/ExaDev/process-graph/commit/03829a1aa0920ed2f45725e2780100632463f1e0))
* **projection:** collapse routes through folded elements instead of enumerating them ([ac38340](https://github.com/ExaDev/process-graph/commit/ac38340bc0561be9e768f3c5f7252602845eddea))
* **projection:** derive loop fragments from strongly connected components ([33164b7](https://github.com/ExaDev/process-graph/commit/33164b753780bea9d07f57609b998091bf893e30))
* **projection:** derive sequence fragments along the path in linear passes ([9b88aa6](https://github.com/ExaDev/process-graph/commit/9b88aa6a48c329bd4fe55cd5a59c3a7a01d43ae9))
* **projection:** hold derived spans by their ends and place fragments by them ([a13f374](https://github.com/ExaDev/process-graph/commit/a13f374359bd7a18034f627c2c678ad90a813eac))
* **projection:** hold each component's targets as a shared structure ([01234b3](https://github.com/ExaDev/process-graph/commit/01234b3de47063ba73e25437cc5a8d7ad53135f8))
* **projection:** index edits and changes in one pass before using them ([32d3d8d](https://github.com/ExaDev/process-graph/commit/32d3d8d7da712a8c83455f4a922d7af11ff788f1))
* **projection:** index folded elements once and build chain lists when read ([301ff7a](https://github.com/ExaDev/process-graph/commit/301ff7af2b3a381c9e463d7b280ada5fc94b80b1))
* **projection:** match repeated sequence steps without copying ([7c7c1e5](https://github.com/ExaDev/process-graph/commit/7c7c1e58bfbe72cac7ac1d3eb1b65e2263b5c2ff))
* **projection:** never fold an element when folding would multiply edges ([0155b13](https://github.com/ExaDev/process-graph/commit/0155b1303d194fb15a1a16ac13637abcf85406fd))
* **projection:** read a target's arriving steps without copying them per chain ([f97affe](https://github.com/ExaDev/process-graph/commit/f97affe947416278911cb48d4af0df0a9f3bc8b4))
* **projection:** share each component's deduplicated targets with every start ([2151361](https://github.com/ExaDev/process-graph/commit/215136191c8d00912fb1f63482b7dad0d45a78b2))
* **projection:** share each element's message positions across authored fragments ([06eff9b](https://github.com/ExaDev/process-graph/commit/06eff9b193654f7a061a41606ed2ee0f24c13587))
* **projection:** share the walk behind merged chains across their targets ([adb0ede](https://github.com/ExaDev/process-graph/commit/adb0edeb079fbc168c0cf0e2dec71a8f28038e14))
* **projection:** walk only folded elements that lead to a drawn element ([91ec8d1](https://github.com/ExaDev/process-graph/commit/91ec8d15ea46b82940592f12d2b6ed4e63d6500b))

### Documentation

* **projection:** document message elements, derived fragments and view inverses ([409239e](https://github.com/ExaDev/process-graph/commit/409239e069ff4c7277546a1b4550f390fbc0be1d))
* **projection:** state the cost model of the projections and inverses ([7ffd826](https://github.com/ExaDev/process-graph/commit/7ffd82681a2af9cc65aa645a1701c4fb819c5f96))

### Code Refactoring

* **projection:** keep the derived operand type internal ([aa8ace9](https://github.com/ExaDev/process-graph/commit/aa8ace958735aa6323408da2968c75ef6e783912))
* **projection:** settle each branching element's shape once ([9d9c9e5](https://github.com/ExaDev/process-graph/commit/9d9c9e59503739c25fee9adf0481f9f157bbb68b))

### Tests

* **projection:** add merged chains over two branches and read every edge ([477fd46](https://github.com/ExaDev/process-graph/commit/477fd464634f4c83b620f45cf62ee5db979331e5))
* **projection:** add shared dead runs and measure edits per item ([c4172a7](https://github.com/ExaDev/process-graph/commit/c4172a7ac3f7894e3b2fc49691fb427f126cd402))
* **projection:** check every reported quadratic shape scales linearly ([a7d67f2](https://github.com/ExaDev/process-graph/commit/a7d67f2f04a98f5cf0caab67e1f7f83a006bd847))
* **projection:** check folding never multiplies edges ([a610839](https://github.com/ExaDev/process-graph/commit/a6108394e656ac9f55349a284fdaceca403aab8a))
* **projection:** count iterator steps and add converging paths and nested authored fragments ([695860a](https://github.com/ExaDev/process-graph/commit/695860a80fe464b244a3a89ac2760378bad2e6df))
* **projection:** count lookups and add serial diamonds and shared-end deletions ([9fdb4f8](https://github.com/ExaDev/process-graph/commit/9fdb4f8c9b529df842ededb71c12b8c5b89045ab))
* **projection:** size the scaling table so it stays quick under load ([7fb623e](https://github.com/ExaDev/process-graph/commit/7fb623e797550c45512316f86c8af3a4d9885a5e))


### Dependencies

- Updated @exadev/process-graph-dag to 1.1.0

## [1.0.3](https://github.com/ExaDev/process-graph/compare/@exadev/process-graph-projection@1.0.2...@exadev/process-graph-projection@1.0.3) (2026-10-10)


### Dependencies

- Updated @exadev/process-graph-schema to 1.1.0

## [1.0.2](https://github.com/ExaDev/process-graph/compare/@exadev/process-graph-projection@1.0.1...@exadev/process-graph-projection@1.0.2) (2026-10-10)

### Build System

* **deps-dev:** bump vitest and @vitest/coverage-v8 together ([0e60e69](https://github.com/ExaDev/process-graph/commit/0e60e698576dd5c2179d2297675673bc504376c7))


### Dependencies

- Updated @exadev/process-graph-schema to 1.0.2

## [1.0.1](https://github.com/ExaDev/process-graph/compare/@exadev/process-graph-projection@1.0.0...@exadev/process-graph-projection@1.0.1) (2026-10-10)

### Documentation

* add repository badges to the README and the building-block package READMEs ([d2a8bc1](https://github.com/ExaDev/process-graph/commit/d2a8bc148769fb6319bd14c3952a1f3bb0560c4a))


### Dependencies

- Updated @exadev/process-graph-schema to 1.0.1

## 1.0.0 (2026-10-10)

### Features

* add projection package ([b449b22](https://github.com/ExaDev/process-graph/commit/b449b2240336c35de9f848ba43b315b12adf4adf))
* **projection:** draw authored fragments in sequence diagrams ([c22ba20](https://github.com/ExaDev/process-graph/commit/c22ba201d38e41fe4af40df680f97b5c7611fbe9))
* **projection:** export the unrepresented element types ([966e2aa](https://github.com/ExaDev/process-graph/commit/966e2aa8457aad7860cb9dcec14e7b372d38ebb4))
* **projection:** give every declared actor a swimlane lane ([5ebd366](https://github.com/ExaDev/process-graph/commit/5ebd36691c7630dba3eb5fa9e07ecbd783cf0f52))
* **projection:** report what each projection dropped as a loss list ([db7fa83](https://github.com/ExaDev/process-graph/commit/db7fa839a2ee0eb577c71bdfdeb6cc338a023df9))
* **projection:** scope a state machine to the activities that affect its subject ([e103f3a](https://github.com/ExaDev/process-graph/commit/e103f3a3e944d4ee8ff984e4b0a1893917deb573))
* **schema:** add artefacts as data and deliverable dependencies ([de4793f](https://github.com/ExaDev/process-graph/commit/de4793f41e33ec6cbe8cb47d1bb2b32c637d2390))

### Bug Fixes

* **projection:** report elements and steps a projection drops ([88b1721](https://github.com/ExaDev/process-graph/commit/88b1721f45af14a7853c9fdbadc3b2398e3c66db))


### Dependencies

- Updated @exadev/process-graph-schema to 1.0.0
