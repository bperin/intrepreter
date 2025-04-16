import { createGlobalStyle, ThemeProvider as StyledThemeProvider } from "styled-components";
import { theme, Theme } from "../theme"; // Import from the central theme file

const GlobalStyle = createGlobalStyle<{ theme: Theme }>`
  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }

  body {
    background-color: ${({ theme }) => theme.colors.background.primary};
    color: ${({ theme }) => theme.colors.text.primary};
    font-family: ${({ theme }) => theme.typography.fontFamily};
    line-height: 1.6;
  }

  button {
    cursor: pointer;
    border: none;
    background: none;
    font-family: inherit;
  }

  a {
    color: ${({ theme }) => theme.colors.action.primary};
    text-decoration: none;

    &:hover {
        text-decoration: underline;
    }
  }

  h1, h2, h3, h4, h5, h6 {
      font-weight: ${({ theme }) => theme.typography.weights.bold};
  }
`;

interface ThemeProviderProps {
    children: React.ReactNode;
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children }) => {
    return (
        <StyledThemeProvider theme={theme}>
            {" "}
            {/* Pass the imported theme */}
            <GlobalStyle theme={theme} /> {/* Pass the theme prop explicitly to GlobalStyle */}
            {children}
        </StyledThemeProvider>
    );
};
