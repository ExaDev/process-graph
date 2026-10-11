import { createTheme, createThemeContract } from "@vanilla-extract/css";
import { darkValues, lightValues, themeShape } from "./theme-values.ts";

/**
 * The theme contract: one CSS custom property per value of `ThemeValues`, read by every style in this package. A consumer restyles the components by assigning these properties, with its own `createTheme(vars, values)` class or `assignVars`, without forking them.
 */
export const vars = createThemeContract(themeShape);

/** The class that assigns the light theme's values. */
export const lightTheme = createTheme(vars, lightValues, "light");

/** The class that assigns the dark theme's values. */
export const darkTheme = createTheme(vars, darkValues, "dark");
