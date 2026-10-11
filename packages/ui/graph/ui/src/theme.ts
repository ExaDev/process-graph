/**
 * The `./theme` entry: the theme contract `vars`, the `lightTheme` and `darkTheme` classes and the values they assign, without the components. A Vanilla Extract stylesheet that themes the components with `createTheme(vars, values)` or `assignVars` imports this entry, so building it loads no React and no component code. The compiled rules for these classes are in `style.css`, the same stylesheet the components use.
 */
export { vars, lightTheme, darkTheme } from "./theme.css.ts";
export { lightValues, darkValues, type ThemeValues } from "./theme-values.ts";
