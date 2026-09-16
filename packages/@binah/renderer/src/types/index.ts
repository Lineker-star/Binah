// The slide object model is the canonical contract from @binah/dsl. The renderer
// no longer vendors its own copy; it re-exports the DSL types here so the public
// `@binah/renderer/types` surface stays intact.
export * from '@binah/dsl';
export * from './effects';
