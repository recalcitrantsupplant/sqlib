# Changelog

## [0.2.0](https://github.com/recalcitrantsupplant/sqlib/compare/v0.1.0...v0.2.0) (2026-09-18)


### Features

* **web:** keep the last run of a record in the browser ([02d99b1](https://github.com/recalcitrantsupplant/sqlib/commit/02d99b199b681b0cf09214a683cc66c47cf16216))


### Bug Fixes

* **api:** allow the Accept header through CORS, and report the data graph caps ([a0d58c8](https://github.com/recalcitrantsupplant/sqlib/commit/a0d58c836d2b57d998ae26bf35200b77d932dff6))
* nineteen UI and API fixes, and guards for the classes five of them shared ([b8e9f84](https://github.com/recalcitrantsupplant/sqlib/commit/b8e9f847cdbe1ef8e5f123800b80109e908ced73))
* **web:** cap the chooser menu's height so a long list scrolls ([58b4ea1](https://github.com/recalcitrantsupplant/sqlib/commit/58b4ea1f6f37955c7256bfdff5cd52f29a4425f8))
* **web:** draw the subject tests run row as a button, and only with tests ([d93c88e](https://github.com/recalcitrantsupplant/sqlib/commit/d93c88e73ce7012a03220cb84896403ceb99db89))
* **web:** let an argument set rename and remove its tables ([f5c1556](https://github.com/recalcitrantsupplant/sqlib/commit/f5c1556cbb4ee47690cb55aa7f63911569f98aa8))
* **web:** let the record-switch guard follow the configured base URL ([7c5b851](https://github.com/recalcitrantsupplant/sqlib/commit/7c5b8517a7c134cc4f588391d6fb6fbd76f05605))
* **web:** offer a new library from the library switcher ([6bc7fc9](https://github.com/recalcitrantsupplant/sqlib/commit/6bc7fc901ecb464eca4850a8fe99b052c2e84f83))
* **web:** offer only the subject kinds this build can test ([6e70a60](https://github.com/recalcitrantsupplant/sqlib/commit/6e70a600399dde848d6076bae6846fcdaa501031))
* **web:** read the tuple set caps from the server, as data graphs now do ([a9e43a8](https://github.com/recalcitrantsupplant/sqlib/commit/a9e43a87d5f637ebd23934dd76561672358dcc08))
* **web:** register the node label helpers with Nuxt once ([92ea5ce](https://github.com/recalcitrantsupplant/sqlib/commit/92ea5ce4dcf4f3f76db1e13abb37f77d4bccad34))
* **web:** register the node label helpers with Nuxt once ([f2774f5](https://github.com/recalcitrantsupplant/sqlib/commit/f2774f58136323d3a4c74e98738cc577bb4eafb6))
* **web:** rename an argument set in place, not in a browser dialog ([a7f18bc](https://github.com/recalcitrantsupplant/sqlib/commit/a7f18bcd8bcad4633292f7d16eae2c5a9151fe3b))
* **web:** replace the remaining native dialogs, and ban them ([dd96c42](https://github.com/recalcitrantsupplant/sqlib/commit/dd96c422b2c8b9d52187ddfef82a958edd1b32d9))
* **web:** rework the arguments tab's pop-out and empty state ([ddaa570](https://github.com/recalcitrantsupplant/sqlib/commit/ddaa57065b5161ad3c38a18f3b63651f8432a138))
* **web:** say how a subject's test list relates to the record above it ([2ee3987](https://github.com/recalcitrantsupplant/sqlib/commit/2ee3987d26ca6d630dca1a4585de92587d156cda))
* **web:** show what a section holds when nothing in it is open ([b77a52f](https://github.com/recalcitrantsupplant/sqlib/commit/b77a52fe11b777f594bda4f9207dd25280fb8583))
* **web:** state the server's data graph limits, and where uploads live ([8fbaa02](https://github.com/recalcitrantsupplant/sqlib/commit/8fbaa02e972541592dd140f98b2ad78a89926879))
* **web:** style the elements whose classes nothing reached ([3b5cc53](https://github.com/recalcitrantsupplant/sqlib/commit/3b5cc535bf2aac8f529e29f3f5cfb0236f92e199))
* **web:** swap a record in place, and let a cross-section link keep its record ([f6f68e0](https://github.com/recalcitrantsupplant/sqlib/commit/f6f68e0243731b1d0c066bc84a5aab74698d26ec))

## 0.1.0 (2026-09-15)


### Features

* port the work merged into the backup repository since the initial import ([39dc6ec](https://github.com/recalcitrantsupplant/sqlib/commit/39dc6ecdd9de11e0efc04a34f558bdd0e0fbd06b))


### Bug Fixes

* **api:** restore the hand-written type shims dropped by .gitignore ([007f9f2](https://github.com/recalcitrantsupplant/sqlib/commit/007f9f27260266e827ec6af890ef6c00754ddb5d))
* **build:** keep tsbuildinfo inside outDir so a deleted dist rebuilds ([94b73f3](https://github.com/recalcitrantsupplant/sqlib/commit/94b73f31444d77981fecb36bbb2b84100a96a9d6))
* **ci:** grant the image job the scopes its called workflow requests ([0716c99](https://github.com/recalcitrantsupplant/sqlib/commit/0716c99bfda1078b56ff3634b01f1ca7ad174785))
* **ci:** grant the image job the scopes its called workflow requests ([1cdfe57](https://github.com/recalcitrantsupplant/sqlib/commit/1cdfe57909becf548d18fc7fc4f714cb3f50cfae))
* **ci:** push the image to a GHCR package this repository owns ([0f899e3](https://github.com/recalcitrantsupplant/sqlib/commit/0f899e302b6c61e9b01c7598e80cbf99f51d1362))
* **justfile:** build the packages the run recipes actually need ([907a457](https://github.com/recalcitrantsupplant/sqlib/commit/907a457514c17c0ee761274b402ddc349430d468))
* **web:** ask for the rule-tuples extension when Playwright does the build ([76e09ef](https://github.com/recalcitrantsupplant/sqlib/commit/76e09eff8b6553dd681a92776bf71e8a693c03d9))


### Continuous Integration

* **release:** version the server image with release-please ([456d105](https://github.com/recalcitrantsupplant/sqlib/commit/456d105f9b005f07659f0e338dccb1284236b346))
