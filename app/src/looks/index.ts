// Three looks for the home screen, switched by one attribute on <html>. Without it the
// default look in styles.css stays exactly as it is. See README.md in this folder.
import './gallery.css';
import './clean.css';
import './paper.css';

export const LOOKS = ['gallery', 'clean', 'paper'] as const;
export type Look = (typeof LOOKS)[number];

function isLook(name: string): name is Look {
  return (LOOKS as readonly string[]).includes(name);
}

/** Switch to a look by name; null or an unknown name goes back to the default look. */
export function applyLook(name: string | null): void {
  const root = document.documentElement;
  if (name && isLook(name)) root.dataset.look = name;
  else delete root.dataset.look;
}
