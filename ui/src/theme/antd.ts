import { theme, type ThemeConfig } from "antd";

/**
 * antd v6 theme, driven by the DESIGN.md palette (§3). antd's ConfigProvider is
 * token-based, so the whole component library inherits the "Quiet Workshop"
 * colours/radii/typography instead of antd's stock blue.
 *
 * The hex values here mirror `src/index.css`; that file stays the source of
 * truth for the few custom bits (paper grain, priority stripes, scrollbars).
 */

export const FONT_STACK =
  '"IBM Plex Sans", system-ui, -apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
export const FONT_MONO = '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

export type ResolvedTheme = "light" | "dark";

interface Palette {
  primary: string;
  accentSoft: string;
  accentInk: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  textDisabled: string;
  bgApp: string;
  bgSurface: string;
  bgElevated: string;
  bgSunken: string;
  border: string;
  borderSecondary: string;
  fill: string;
}

const LIGHT: Palette = {
  primary: "#0E6E63",
  accentSoft: "#E3EFEB",
  accentInk: "#0A4A43",
  success: "#3F7C4F",
  warning: "#B9882B",
  danger: "#C23B2E",
  info: "#4A6FA5",
  text: "#211F1C",
  textSecondary: "#57524A",
  textTertiary: "#8A8378",
  textDisabled: "#B4AC9F",
  bgApp: "#F6F3EE",
  bgSurface: "#FCFAF7",
  bgElevated: "#FFFFFF",
  bgSunken: "#ECE8E0",
  border: "#CFC8BB",
  borderSecondary: "#E4DFD7",
  fill: "rgba(33, 31, 28, 0.05)",
};

const DARK: Palette = {
  primary: "#3FA795",
  accentSoft: "#12312C",
  accentInk: "#8FD8CC",
  success: "#5AA06B",
  warning: "#D8A94A",
  danger: "#E06B5E",
  info: "#6E9BD1",
  text: "#EDE9E2",
  textSecondary: "#B3ACA0",
  textTertiary: "#857E72",
  textDisabled: "#5A544C",
  bgApp: "#1A1816",
  bgSurface: "#211F1D",
  bgElevated: "#2A2724",
  bgSunken: "#141311",
  border: "#3D3933",
  borderSecondary: "#2E2B27",
  fill: "rgba(237, 233, 226, 0.06)",
};

export function buildAntdTheme(resolved: ResolvedTheme): ThemeConfig {
  const c = resolved === "dark" ? DARK : LIGHT;
  return {
    algorithm: resolved === "dark" ? theme.darkAlgorithm : theme.defaultAlgorithm,
    token: {
      colorPrimary: c.primary,
      colorLink: c.primary,
      colorLinkHover: c.primary,
      colorSuccess: c.success,
      colorWarning: c.warning,
      colorError: c.danger,
      colorInfo: c.info,
      colorTextBase: c.text,
      colorBgBase: c.bgApp,
      colorBgLayout: c.bgApp,
      colorBgContainer: c.bgSurface,
      colorBgElevated: c.bgElevated,
      colorText: c.text,
      colorTextSecondary: c.textSecondary,
      colorTextTertiary: c.textTertiary,
      colorTextQuaternary: c.textDisabled,
      colorBorder: c.border,
      colorBorderSecondary: c.borderSecondary,
      colorSplit: c.borderSecondary,
      colorFillTertiary: c.fill,
      borderRadius: 6,
      borderRadiusSM: 4,
      borderRadiusLG: 10,
      fontFamily: FONT_STACK,
      fontSize: 14,
      controlHeight: 32,
      controlHeightSM: 26,
      controlHeightLG: 40,
      lineWidth: 1,
      wireframe: false,
    },
    components: {
      Layout: {
        bodyBg: c.bgApp,
        siderBg: c.bgSunken,
        headerBg: c.bgApp,
      },
      Menu: {
        itemBg: "transparent",
        subMenuItemBg: "transparent",
        itemColor: c.textSecondary,
        itemHoverBg: c.fill,
        itemHoverColor: c.text,
        itemSelectedBg: c.accentSoft,
        itemSelectedColor: c.accentInk,
        itemHeight: 32,
        itemMarginInline: 0,
        itemMarginBlock: 2,
        itemBorderRadius: 6,
        itemPaddingInline: 8,
        iconMarginInlineEnd: 8,
        iconSize: 16,
        collapsedIconSize: 16,
        activeBarBorderWidth: 0,
        groupTitleColor: c.textTertiary,
      },
      Card: {
        paddingLG: 16,
        colorBorderSecondary: c.borderSecondary,
      },
      Segmented: {
        itemSelectedBg: c.accentSoft,
        itemSelectedColor: c.accentInk,
        trackBg: c.bgSunken,
      },
      Drawer: {
        paddingLG: 16,
      },
      Typography: {
        titleMarginTop: 0,
        titleMarginBottom: "0.4em",
      },
      Table: {
        headerBg: c.bgSunken,
        borderColor: c.borderSecondary,
      },
      Tooltip: {
        colorBgSpotlight: resolved === "dark" ? "#000000" : "#211F1C",
      },
    },
  };
}
