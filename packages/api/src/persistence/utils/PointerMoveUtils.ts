import { createEntityUtilsWithFields } from './EntityUtils.js';
import { PointerMoveSchema, type PersistedPointerMove } from '../schemas/PointerMoveSchema.js';

const PointerMoveUtils = createEntityUtilsWithFields<PersistedPointerMove>(PointerMoveSchema, 'PointerMove');

export const PointerMoves = PointerMoveUtils.Repository;
