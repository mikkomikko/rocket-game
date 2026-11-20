/* The active map's rules: an object of optional hooks (coop, breakAt, bulletHit, onKill and so on; the
 * client's maps/index.js documents them all). Whoever runs the game plugs in a function that returns the
 * active map's object; until then every map plays like plain rock. */
const NONE = {};
let current = () => NONE;
export const setMapRules = (fn) => { current = fn; };
export const mapRules = () => current();
