import React from "react";
import styled, { css } from "styled-components";
import { Theme } from "../../theme"; // Adjust path as needed based on theme location

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: "primary" | "secondary" | "danger";
    size?: "sm" | "md" | "lg";
    isLoading?: boolean;
    theme: Theme; // Explicitly require theme for styling
};

const getVariantStyles = (theme: Theme, variant: ButtonProps["variant"] = "primary") => {
    switch (variant) {
        case "secondary":
            return css`
                background-color: ${theme.colors.background.secondary};
                color: ${theme.colors.text.primary};
                border: 1px solid ${theme.colors.border.light};
                &:hover:not(:disabled) {
                    background-color: ${theme.colors.background.tertiary};
                }
            `;
        case "danger":
            return css`
                background-color: ${theme.colors.status.error};
                color: white;
                border: 1px solid ${theme.colors.status.error};
                &:hover:not(:disabled) {
                    background-color: ${theme.colors.status.error}; // Darken or adjust hover
                    opacity: 0.9;
                }
            `;
        case "primary":
        default:
            return css`
                background-color: ${theme.colors.action.primary};
                color: white;
                border: 1px solid ${theme.colors.action.primary};
                &:hover:not(:disabled) {
                    background-color: ${theme.colors.action.hover};
                }
            `;
    }
};

const getSizeStyles = (theme: Theme, size: ButtonProps["size"] = "md") => {
    switch (size) {
        case "sm":
            return css`
                padding: ${theme.spacing.xs} ${theme.spacing.sm};
                font-size: ${theme.typography.sizes.sm};
            `;
        case "lg":
            return css`
                padding: ${theme.spacing.md} ${theme.spacing.xl};
                font-size: ${theme.typography.sizes.lg};
            `;
        case "md":
        default:
            return css`
                padding: ${theme.spacing.sm} ${theme.spacing.md};
                font-size: ${theme.typography.sizes.base};
            `;
    }
};

const StyledButton = styled.button<ButtonProps>`
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: ${({ theme }) => theme.borderRadius.md};
    font-weight: ${({ theme }) => theme.typography.weights.medium};
    cursor: pointer;
    transition: all 0.2s ease-in-out;
    white-space: nowrap;

    ${({ theme, variant }) => getVariantStyles(theme, variant)}
    ${({ theme, size }) => getSizeStyles(theme, size)}

  &:disabled {
        opacity: 0.6;
        cursor: not-allowed;
    }

    // Add styles for isLoading state if needed
    // Example: Show a spinner
    ${({ isLoading }) =>
        isLoading &&
        css`
            cursor: wait;
            /* Add spinner styles here */
        `}
`;

// Need to wrap with ThemeProvider or rely on theme being provided by parent
// For direct use, ensure theme is passed or available via context
const Button: React.FC<Omit<ButtonProps, "theme"> & { theme?: Theme }> = ({ children, ...props }) => {
    // This component likely expects the theme from a ThemeProvider higher up.
    // If used outside ThemeProvider, it might break without an explicit theme prop.
    // The styled component itself requires the theme, which styled-components injects
    // if a ThemeProvider is present.
    return <StyledButton {...props}>{children}</StyledButton>;
};

export default Button;
