import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link, Navigate } from 'react-router-dom';
import styled, { createGlobalStyle } from 'styled-components';
import { ThemeProvider } from 'styled-components';
import { theme } from './theme';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ErrorProvider } from './context/ErrorContext';
import { ConversationProvider } from './context/ConversationContext';
import ErrorDisplay from './components/ErrorDisplay';
import DashboardPage from './pages/DashboardPage';
import LoginPage from './pages/LoginPage';
import LandingPage from './pages/LandingPage';
import RegistrationPage from './pages/RegisterPage';

const GlobalStyle = createGlobalStyle`
  body {
    margin: 0;
    padding: 0;
    font-family: ${({ theme }) => theme.typography.fontFamily};
    background-color: ${({ theme }) => theme.colors.background.primary};
    color: ${({ theme }) => theme.colors.text.primary};
    box-sizing: border-box;
  }
  *, *::before, *::after {
    box-sizing: inherit;
  }
`;

const AppContainer = styled.div`
    min-height: 100vh;
    display: flex;
    flex-direction: column;
`;

const Header = styled.header`
    background-color: ${({ theme }) => theme.colors.background.primary};
    padding: ${({ theme }) => theme.spacing.md} ${({ theme }) => theme.spacing.xl};
    border-bottom: 1px solid ${({ theme }) => theme.colors.border.light};
    display: flex;
    justify-content: space-between;
    align-items: center;
`;

const Logo = styled(Link)`
    color: ${({ theme }) => theme.colors.text.primary};
    font-size: ${({ theme }) => theme.typography.sizes.lg};
    font-weight: ${({ theme }) => theme.typography.weights.bold};
    text-decoration: none;
`;

const Nav = styled.nav`
    display: flex;
    align-items: center;
    gap: ${({ theme }) => theme.spacing.lg};
`;

const NavLink = styled(Link)`
    color: ${({ theme }) => theme.colors.text.secondary};
    text-decoration: none;
    font-size: ${({ theme }) => theme.typography.sizes.sm};
    transition: color 0.2s ease;

    &:hover {
        color: ${({ theme }) => theme.colors.text.primary};
    }
`;

// Re-add AuthInfo and LogoutButton styled components
const AuthInfo = styled.div`
    display: flex;
    align-items: center;
    gap: ${({ theme }) => theme.spacing.md};
    color: ${({ theme }) => theme.colors.text.secondary};
    font-size: ${({ theme }) => theme.typography.sizes.sm};
`;

const LogoutButton = styled.button`
    // Adopt styles similar to StartSessionButton but smaller
    background-color: transparent;
    color: ${({ theme }) => theme.colors.text.primary}; // White text
    border: 1px solid ${({ theme }) => theme.colors.text.primary}; // White border
    border-radius: ${({ theme }) => theme.borderRadius.md};
    padding: ${({ theme }) => theme.spacing.xs} ${({ theme }) => theme.spacing.sm}; // Smaller padding
    font-size: ${({ theme }) => theme.typography.sizes.xs}; // Smaller font size
    font-weight: ${({ theme }) => theme.typography.weights.medium};
    cursor: pointer;
    transition: all 0.2s ease;
    line-height: 1; // Ensure text aligns vertically with small padding

    &:hover {
        background-color: ${({ theme }) => theme.colors.text.primary}; // White background
        color: ${({ theme }) => theme.colors.background.primary}; // Dark text
        // Keep border or remove depending on desired hover effect
    }

    &:disabled { // Keep disabled styles if needed elsewhere, otherwise remove
        background-color: transparent;
        border-color: ${({ theme }) => theme.colors.text.secondary}40;
        color: ${({ theme }) => theme.colors.text.secondary}80;
        cursor: not-allowed;
        opacity: 0.6;
    }
`;

const MainContent = styled.main`
    flex: 1;
    /* Add padding or other styles as needed */
`;

// Component to handle protected routes
const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { isAuthenticated, isLoading } = useAuth();

    if (isLoading) {
        return <div>Loading authentication status...</div>; // Or a spinner
    }

    return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />;
};

// AppLayout including Header
const AppLayout: React.FC = () => {
    // Re-add user and logout to useAuth hook
    const { isAuthenticated, user, logout } = useAuth(); 

    return (
        <AppContainer>
            <Header>
                {/* Change Logo text back to Clara.ai */}
                <Logo to={isAuthenticated ? "/dashboard" : "/"}>Clara.ai</Logo> 
                <Nav>
                    {/* Restore conditional rendering for nav links/auth info */}
                    {isAuthenticated ? (
                        <AuthInfo>
                            <span>Logged in as: <strong>{user?.username || 'User'}</strong></span>
                            <LogoutButton onClick={logout}>Logout</LogoutButton>
                        </AuthInfo>
                    ) : (
                        <>
                            <NavLink to="/login">Login</NavLink>
                            <NavLink to="/register">Register</NavLink>
                        </>
                    )}
                </Nav>
            </Header>
            <MainContent>
                <Routes>
                    <Route path="/login" element={<LoginPage />} />
                    <Route path="/register" element={<RegistrationPage />} />
                    <Route
                        path="/dashboard/*"
                        element={
                            <ProtectedRoute>
                                <DashboardPage />
                            </ProtectedRoute>
                        }
                    />
                    <Route 
                        path="/" 
                        element={isAuthenticated ? <Navigate to="/dashboard" /> : <LandingPage />} 
                    />
                    <Route 
                        path="*" 
                        element={<Navigate to={isAuthenticated ? "/dashboard" : "/"} replace />} 
                    />
                </Routes>
            </MainContent>
            <ErrorDisplay />
        </AppContainer>
    );
};

const App: React.FC = () => {
    return (
        <ThemeProvider theme={theme}>
            <GlobalStyle />
            <Router>
                <ErrorProvider>
                    <AuthProvider>
                        <ConversationProvider>
                             <AppLayout /> { /* Use the layout */}
                        </ConversationProvider>
                    </AuthProvider>
                </ErrorProvider>
            </Router>
        </ThemeProvider>
    );
};

export default App;
