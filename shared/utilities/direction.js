import { Direction } from '../web-utilities/localization.js';

/**
 * a method to determine the current localization direction of the view
 * @param rootNode - the HTMLElement to begin the query from, usually "this" when used in a component controller
 * @public
 */
export const getDirection = (rootNode) => {
  const dirNode = rootNode.closest('[dir]');

  return dirNode !== null && dirNode.dir === 'rtl'
    ? Direction.rtl
    : Direction.ltr;
};
