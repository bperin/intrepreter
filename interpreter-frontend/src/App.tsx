// import React from 'react'; // No longer needed for JSX
import { BrowserRouter as Router, Routes, Route, Link } from "react-router-dom";
import styled from "styled-components";
import { Theme } from "./theme";
import { ThemeProvider } from "./components/ThemeProvider";
import { AuthProvider } from "./context/AuthContext";
import { ErrorProvider } from "./context/ErrorContext";
import ProtectedRoute from "./components/ProtectedRoute";
import RegisterPage from "./pages/RegisterPage";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage"; // Import the real DashboardPage

// Define a type for the theme prop
type ThemedProps = {
    theme: Theme;
};

const AppContainer = styled.div<ThemedProps>`
    min-height: 100vh;
    background-color: ${({ theme }) => theme.colors.background.primary};
    color: ${({ theme }) => theme.colors.text.primary};
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Open Sans", "Helvetica Neue", sans-serif;
    font-feature-settings: "ss01", "ss02", "cv01", "cv03";
    letter-spacing: -0.01em;
`;

const Nav = styled.nav<ThemedProps>`
    padding: ${({ theme }) => theme.spacing.md} ${({ theme }) => theme.spacing.xl};
    background-color: ${({ theme }) => theme.colors.background.primary};
    border-bottom: 1px solid ${({ theme }) => theme.colors.border.light}40;
    backdrop-filter: blur(8px);
    position: sticky;
    top: 0;
    z-index: 100;
`;

const NavContent = styled.div<ThemedProps>`
    max-width: 1280px;
    margin: 0 auto;
    display: flex;
    justify-content: space-between;
    align-items: center;
`;

const Logo = styled(Link)<ThemedProps>`
    color: ${({ theme }) => theme.colors.text.primary};
    font-size: ${({ theme }) => theme.typography.sizes.lg};
    font-weight: ${({ theme }) => theme.typography.weights.bold};
    text-decoration: none;
    letter-spacing: -0.03em;
    position: relative;
    padding: 2px 0;

    &:after {
        content: "";
        position: absolute;
        width: 0;
        height: 1px;
        bottom: 0;
        left: 0;
        background-color: ${({ theme }) => theme.colors.text.primary};
        transition: width 0.2s ease;
    }

    &:hover {
        color: ${({ theme }) => theme.colors.text.primary};
        &:after {
            width: 100%;
        }
    }
`;

const NavLinks = styled.div<ThemedProps>`
    display: flex;
    gap: ${({ theme }) => theme.spacing.lg};
`;

const NavLink = styled(Link)<ThemedProps>`
    color: ${({ theme }) => theme.colors.text.secondary};
    text-decoration: none;
    font-weight: ${({ theme }) => theme.typography.weights.medium};
    font-size: 14px;
    padding: 8px 0;
    position: relative;
    transition: all 0.2s;

    &:after {
        content: "";
        position: absolute;
        width: 0;
        height: 1px;
        bottom: 0;
        left: 0;
        background-color: ${({ theme }) => theme.colors.text.primary};
        transition: width 0.2s ease;
    }

    &:hover {
        color: ${({ theme }) => theme.colors.text.primary};
        &:after {
            width: 100%;
        }
    }
`;

const Main = styled.main<ThemedProps>`
    max-width: 1280px;
    margin: 0 auto;
    padding: ${({ theme }) => theme.spacing.xl};
`;

const Hero = styled.section<ThemedProps>`
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: ${({ theme }) => theme.spacing["2xl"]} 0;
    min-height: calc(80vh - 80px);
`;

const HeroTitle = styled.h1<ThemedProps>`
    font-size: clamp(2.5rem, 6vw, 4rem);
    font-weight: ${({ theme }) => theme.typography.weights.bold};
    line-height: 1.1;
    letter-spacing: -0.03em;
    margin-bottom: ${({ theme }) => theme.spacing.xl};
    color: ${({ theme }) => theme.colors.text.primary};
    max-width: 800px;
`;

const HeroSubtitle = styled.p<ThemedProps>`
    font-size: clamp(1rem, 2vw, 1.25rem);
    color: ${({ theme }) => theme.colors.text.secondary};
    max-width: 650px;
    margin: 0 auto ${({ theme }) => theme.spacing.xl};
    line-height: 1.6;
`;

const CTAButton = styled(Link)<ThemedProps>`
    display: inline-block;
    padding: ${({ theme }) => theme.spacing.md} ${({ theme }) => theme.spacing.xl};
    background-color: ${({ theme }) => theme.colors.text.primary};
    color: ${({ theme }) => theme.colors.background.primary};
    border-radius: 4px;
    font-weight: ${({ theme }) => theme.typography.weights.medium};
    font-size: 16px;
    text-decoration: none;
    transition: all 0.15s ease;
    border: 1px solid ${({ theme }) => theme.colors.text.primary};

    &:hover {
        background-color: transparent;
        color: ${({ theme }) => theme.colors.text.primary};
    }
`;

const Features = styled.section<ThemedProps>`
    padding: ${({ theme }) => theme.spacing["2xl"]} 0;
    background-color: ${({ theme }) => theme.colors.background.secondary}20;
    border-top: 1px solid ${({ theme }) => theme.colors.border.light}40;
    border-bottom: 1px solid ${({ theme }) => theme.colors.border.light}40;
`;

const FeaturesTitle = styled.h2<ThemedProps>`
    text-align: center;
    font-size: clamp(1.5rem, 3vw, 2rem);
    font-weight: ${({ theme }) => theme.typography.weights.bold};
    margin-bottom: ${({ theme }) => theme.spacing["2xl"]};
    color: ${({ theme }) => theme.colors.text.primary};
    letter-spacing: -0.02em;
`;

const FeaturesGrid = styled.div<ThemedProps>`
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
    gap: ${({ theme }) => theme.spacing.xl};
    max-width: 1280px;
    margin: 0 auto;
    padding: 0 ${({ theme }) => theme.spacing.xl};
`;

const FeatureCard = styled.div<ThemedProps>`
    background-color: ${({ theme }) => theme.colors.background.primary};
    border-radius: 8px;
    padding: ${({ theme }) => theme.spacing.xl};
    border: 1px solid ${({ theme }) => theme.colors.border.light}30;
    transition: all 0.2s ease;

    &:hover {
        transform: translateY(-4px);
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
        border-color: ${({ theme }) => theme.colors.border.light}60;
    }
`;

const FeatureIcon = styled.div<ThemedProps>`
    font-size: 28px;
    margin-bottom: ${({ theme }) => theme.spacing.md};
    color: ${({ theme }) => theme.colors.text.primary};
`;

const FeatureTitle = styled.h3<ThemedProps>`
    font-size: 20px;
    font-weight: ${({ theme }) => theme.typography.weights.bold};
    margin-bottom: ${({ theme }) => theme.spacing.sm};
    color: ${({ theme }) => theme.colors.text.primary};
    letter-spacing: -0.01em;
`;

const FeatureDescription = styled.p<ThemedProps>`
    color: ${({ theme }) => theme.colors.text.secondary};
    line-height: 1.6;
    font-size: 15px;
`;

function App() {
  return (
        <ThemeProvider>
            <ErrorProvider>
                <AuthProvider>
                    <Router>
                        <AppContainer>
                            <Routes>
                                <Route
                                    path="/"
                                    element={
                                        <>
                                            <Nav>
                                                <NavContent>
                                                    <Logo to="/">Clara.ai</Logo>
                                                    <NavLinks>
                                                        <NavLink to="/register">Register</NavLink>
                                                        <NavLink to="/login">Login</NavLink>
                                                    </NavLinks>
                                                </NavContent>
                                            </Nav>
                                            <Main>
                                                <>
                                                    <Hero>
                                                        <HeroTitle>Real-time Medical Interpretation</HeroTitle>
                                                        <HeroSubtitle>Break down language barriers in healthcare with our AI-powered interpretation system. Enable seamless communication between clinicians and patients in any language.</HeroSubtitle>
                                                        <CTAButton to="/register">Get Started</CTAButton>
                                                    </Hero>

                                                    <Features>
                                                        <FeaturesTitle>Key Features</FeaturesTitle>
                                                        <FeaturesGrid>
                                                            <FeatureCard>
                                                                <FeatureIcon>🎯</FeatureIcon>
                                                                <FeatureTitle>Real-time Translation</FeatureTitle>
                                                                <FeatureDescription>Seamless interpretation between English and Spanish during medical consultations. No more waiting for human interpreters or dealing with language barriers.</FeatureDescription>
                                                            </FeatureCard>

                                                            <FeatureCard>
                                                                <FeatureIcon>🔊</FeatureIcon>
                                                                <FeatureTitle>Speech Recognition</FeatureTitle>
                                                                <FeatureDescription>Advanced speech-to-text and text-to-speech capabilities powered by OpenAI's Realtime API. Natural, fluid conversations in any language.</FeatureDescription>
                                                            </FeatureCard>

                                                            <FeatureCard>
                                                                <FeatureIcon>🔄</FeatureIcon>
                                                                <FeatureTitle>Smart Commands</FeatureTitle>
                                                                <FeatureDescription>Support for special commands like "repeat that" to ensure clear communication. Never miss important information during consultations.</FeatureDescription>
                                                            </FeatureCard>

                                                            <FeatureCard>
                                                                <FeatureIcon>📝</FeatureIcon>
                                                                <FeatureTitle>Automated Actions</FeatureTitle>
                                                                <FeatureDescription>Automatically detect and execute actions like scheduling follow-ups and sending lab orders. Streamline your workflow and reduce administrative tasks.</FeatureDescription>
                                                            </FeatureCard>

                                                            <FeatureCard>
                                                                <FeatureIcon>📊</FeatureIcon>
                                                                <FeatureTitle>Conversation Summary</FeatureTitle>
                                                                <FeatureDescription>Get a comprehensive summary of each consultation, including detected actions and key points. Perfect for documentation and follow-up care.</FeatureDescription>
                                                            </FeatureCard>

                                                            <FeatureCard>
                                                                <FeatureIcon>💾</FeatureIcon>
                                                                <FeatureTitle>Secure Storage</FeatureTitle>
                                                                <FeatureDescription>All conversations and summaries are securely stored in the database. Easy access to patient history and consultation records.</FeatureDescription>
                                                            </FeatureCard>
                                                        </FeaturesGrid>
                                                    </Features>
                                                </>
                                            </Main>
                                        </>
                                    }
                                />
                                <Route
                                    path="/register"
                                    element={
                                        <>
                                            <Nav>
                                                <NavContent>
                                                    <Logo to="/">Clara.ai</Logo>
                                                    <NavLinks>
                                                        <NavLink to="/register">Register</NavLink>
                                                        <NavLink to="/login">Login</NavLink>
                                                    </NavLinks>
                                                </NavContent>
                                            </Nav>
                                            <Main>
                                                <RegisterPage />
                                            </Main>
                                        </>
                                    }
                                />
                                <Route
                                    path="/login"
                                    element={
                                        <>
                                            <Nav>
                                                <NavContent>
                                                    <Logo to="/">Clara.ai</Logo>
                                                    <NavLinks>
                                                        <NavLink to="/register">Register</NavLink>
                                                        <NavLink to="/login">Login</NavLink>
                                                    </NavLinks>
                                                </NavContent>
                                            </Nav>
                                            <Main>
                                                <LoginPage />
                                            </Main>
                                        </>
                                    }
                                />

                                <Route
                                    path="/dashboard"
                                    element={
                                        <ProtectedRoute>
                                            <DashboardPage />
                                        </ProtectedRoute>
                                    }
                                />
                            </Routes>
                        </AppContainer>
                    </Router>
                </AuthProvider>
            </ErrorProvider>
        </ThemeProvider>
    );
}

export default App;
