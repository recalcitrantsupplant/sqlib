// `vue-sonner/style.css` is a side-effect CSS import (see src/app.vue). The
// package ships no type declarations for it, and this project's tsconfig
// deliberately omits `vite/client` from `types` (see tsconfig.json's
// `//baseUrl` note) so the ambient `*.css` module it would otherwise provide
// is not in scope.
declare module 'vue-sonner/style.css';
