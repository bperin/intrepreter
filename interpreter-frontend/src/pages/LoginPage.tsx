import React, { useState } from "react";
import styled from "styled-components";
import { useNavigate } from "react-router-dom";
import { Theme } from "../theme";
import { useAuth } from "../context/AuthContext";
import { useError } from "../context/ErrorContext";
import api from "../lib/api";

// Define a type for the theme prop
type ThemedProps = { theme: Theme };

const PageContainer = styled.div<ThemedProps>`
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: calc(100vh - 150px);
    padding: ${({ theme }) => theme.spacing.xl};
`;

const FormContainer = styled.div<ThemedProps>`
    background-color: ${({ theme }) => theme.colors.background.primary};
    padding: ${({ theme }) => theme.spacing["2xl"]};
    border-radius: 8px;
    width: 100%;
    max-width: 400px;
    text-align: center;
    border: 1px solid ${({ theme }) => theme.colors.border.light}40;
`;

const Title = styled.h2<ThemedProps>`
    margin-bottom: ${({ theme }) => theme.spacing.xl};
    color: ${({ theme }) => theme.colors.text.primary};
    font-size: 24px;
    font-weight: ${({ theme }) => theme.typography.weights.bold};
    letter-spacing: -0.02em;
`;

const Form = styled.form<ThemedProps>`
    display: flex;
    flex-direction: column;
    gap: ${({ theme }) => theme.spacing.lg};
`;

const Input = styled.input<ThemedProps>`
    padding: ${({ theme }) => theme.spacing.md};
    border: 1px solid ${({ theme }) => theme.colors.border.light}60;
    background-color: transparent;
    color: ${({ theme }) => theme.colors.text.primary};
    border-radius: 4px;
    font-size: 16px;
    transition: all 0.2s ease;

    &:focus {
        outline: none;
        border-color: ${({ theme }) => theme.colors.text.primary};
        box-shadow: 0 0 0 1px ${({ theme }) => theme.colors.text.primary}30;
    }

    &::placeholder {
        color: ${({ theme }) => theme.colors.text.secondary}80;
    }
`;

const Button = styled.button<ThemedProps>`
    padding: ${({ theme }) => theme.spacing.md};
    background-color: transparent;
    color: ${({ theme }) => theme.colors.text.primary};
    border: 1px solid ${({ theme }) => theme.colors.text.primary};
    border-radius: 4px;
    cursor: pointer;
    font-size: 16px;
    font-weight: ${({ theme }) => theme.typography.weights.medium};
    transition: all 0.15s ease;
    margin-top: ${({ theme }) => theme.spacing.md};

    &:hover {
        background-color: ${({ theme }) => theme.colors.text.primary};
        color: ${({ theme }) => theme.colors.background.primary};
    }

    &:disabled {
        background-color: transparent;
        border-color: ${({ theme }) => theme.colors.text.secondary}40;
        color: ${({ theme }) => theme.colors.text.secondary}80;
        cursor: not-allowed;
    }
`;

const LoginPage: React.FC = () => {
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const navigate = useNavigate();
    const { login } = useAuth();
    const { showApiError } = useError();

    const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setIsLoading(true);

        try {
            const response = await api.post("/auth/login", { username, password });
            const data = response.data;

            if (data.accessToken && data.refreshToken) {
                login(data.accessToken, data.refreshToken);
                navigate("/dashboard");
            } else {
                throw new Error("Login successful but tokens not received from server.");
            }
        } catch (err: unknown) {
            showApiError(err, "Login failed");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <PageContainer>
            <FormContainer>
                <Title>Sign In</Title>
                <Form onSubmit={handleSubmit}>
                    <Input type="text" placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} required disabled={isLoading} />
                    <Input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required disabled={isLoading} />
                    <Button type="submit" disabled={isLoading}>
                        {isLoading ? "Signing in..." : "Sign In"}
                    </Button>
                </Form>
            </FormContainer>
        </PageContainer>
    );
};

export default LoginPage;
