export const theme = {
    colors: {
        background: {
            primary: "#1A1A1A", // Very dark gray
            secondary: "#2A2A2A", // Dark gray
            tertiary: "#333333", // Medium-dark gray
            card: "#2A2A2A", // Card background
            sidebar: "#1A1A1A", // Sidebar background
            hover: "#383838", // Hover state
        },
        text: {
            primary: "#F5F5F5", // Almost white
            secondary: "#B0B0B0", // Light gray
            accent: "#FFFFFF", // White
            muted: "#808080", // Medium gray
        },
        border: {
            light: "#333333", // Medium-dark gray
            dark: "#101010", // Almost black
        },
        status: {
            success: "#10B981", // Green
            warning: "#F59E0B", // Amber
            error: "#EF4444", // Red
            info: "#B0B0B0", // Light gray for info
        },
        action: {
            primary: "#F5F5F5", // Almost white
            hover: "#E0E0E0", // Lighter gray hover for white primary
            disabled: "#606060", // Darker gray disabled
        },
        dashboard: {
            highlight: "#FFFFFF", // White highlight
            divider: "#333333", // Medium-dark gray
            icon: "#B0B0B0", // Light gray
            iconHover: "#FFFFFF", // White
        },
    },
    typography: {
        fontFamily: "Inter, system-ui, sans-serif",
        sizes: {
            xs: "0.75rem",
            sm: "0.875rem",
            base: "1rem",
            lg: "1.125rem",
            xl: "1.25rem",
            "2xl": "1.5rem",
            "3xl": "1.875rem",
        },
        weights: {
            normal: 400,
            medium: 500,
            semibold: 600,
            bold: 700,
        },
    },
    spacing: {
        xs: "0.25rem",
        sm: "0.5rem",
        md: "1rem",
        lg: "1.5rem",
        xl: "2rem",
        "2xl": "3rem",
    },
    borderRadius: {
        sm: "0.25rem",
        md: "0.375rem",
        lg: "0.5rem",
        xl: "0.75rem",
        full: "9999px",
    },
    shadows: {
        sm: "0 1px 2px 0 rgba(0, 0, 0, 0.15)", // Slightly darker shadow for contrast
        md: "0 4px 6px -1px rgba(0, 0, 0, 0.2)",
        lg: "0 10px 15px -3px rgba(0, 0, 0, 0.2)",
    },
} as const;

export type Theme = typeof theme;
