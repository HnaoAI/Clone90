// Petits helpers de création d'éléments (T3). Pas d'innerHTML : le texte passe toujours par textContent.
// `doc` est injectable pour les tests (document factice).

/**
 * Crée un élément.
 * @param {string} tag
 * @param {{class?: string, text?: string, attrs?: Object<string,string>, dataset?: Object<string,string>,
 *          on?: Object<string, Function>}} [props]
 * @param {Array<Node|string|null|false|undefined>} [children] chaînes converties en texte ; null/false ignorés
 * @param {Document} [doc]
 */
export function el(tag, props = {}, children = [], doc = globalThis.document) {
  const node = doc.createElement(tag);
  if (props.class) node.setAttribute('class', props.class);
  if (props.text != null) node.textContent = props.text;
  for (const [k, v] of Object.entries(props.attrs ?? {})) node.setAttribute(k, v);
  for (const [k, v] of Object.entries(props.dataset ?? {})) node.dataset[k] = v;
  for (const [k, fn] of Object.entries(props.on ?? {})) node.addEventListener(k, fn);
  const kids = children.filter((c) => c != null && c !== false)
    .map((c) => (typeof c === 'string' ? doc.createTextNode(c) : c));
  if (kids.length) node.append(...kids);
  return node;
}

/** Vide un conteneur. */
export const clear = (node) => node.replaceChildren();
