import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link, Navigate } from 'react-router-dom';
import styled from 'styled-components';
import { ThemeProvider } from 'styled-components';
import { GlobalStyle, theme } from './theme';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ErrorProvider } from './context/ErrorContext';
import { ConversationProvider } from './context/ConversationContext';
import ErrorDisplay from './components/ErrorDisplay';
import DashboardPage from './pages/DashboardPage';
import LoginPage from './pages/LoginPage';
import RegistrationPage from './pages/RegistrationPage';

const AppContainer = styled.div`
    min-height: 100vh;
    display: flex;
    flex-direction: column;
`;

const Header = styled.header`
    background-color: ${({ theme }) => theme.colors.background.secondary};
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

const AuthInfo = styled.div`
    display: flex;
    align-items: center;
    gap: ${({ theme }) => theme.spacing.md};
    color: ${({ theme }) => theme.colors.text.secondary};
    font-size: ${({ theme }) => theme.typography.sizes.sm};
`;

const LogoutButton = styled.button`
    background: none;
    border: none;
    color: ${({ theme }) => theme.colors.status.error};
    cursor: pointer;
    font-size: ${({ theme }) => theme.typography.sizes.sm};
    padding: 0;
    transition: color 0.2s ease;

    &:hover {
        color: ${({ theme }) => theme.colors.status.error}D0; // Slightly darker on hover
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
    const { isAuthenticated, user, logout } = useAuth();

    return (
        <AppContainer>
            <Header>
                <Logo to={isAuthenticated ? "/dashboard" : "/"}>Interpreter</Logo>
                <Nav>
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
                        path="/dashboard"
                        element={
                            <ProtectedRoute>
                                <DashboardPage />
                            </ProtectedRoute>
                        }
                    />
                    {/* Redirect root path based on auth status */}
                    <Route path="*" element={<Navigate to={isAuthenticated ? "/dashboard" : "/login"} replace />} />
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
