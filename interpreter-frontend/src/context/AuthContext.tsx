import React, { createContext, useState, useContext, useEffect, ReactNode } from "react";
import apiClient, { setAuthContext } from '../api/apiClient';

export interface AuthContextType {
    isAuthenticated: boolean;
    isLoading: boolean;
    login: (email: string, pass: string) => Promise<void>;
    logout: () => void;
    user: any | null;
    setToken: (token: string | null) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [user, setUser] = useState<any | null>(null);

    useEffect(() => {
        setAuthContext(authContextValue);
    }, []);

    useEffect(() => {
        const token = localStorage.getItem('accessToken');
        if (token) {
            setIsAuthenticated(true);
        }
        setIsLoading(false);
    }, []);

    const login = async (email: string, pass: string): Promise<void> => {
        setIsLoading(true);
        try {
            const response = await apiClient.post('/auth/login', { email, password: pass });
            const { accessToken, refreshToken } = response.data;

            localStorage.setItem('accessToken', accessToken);
            localStorage.setItem('refreshToken', refreshToken);
            setIsAuthenticated(true);
            console.log('Login successful');

        } catch (error) {
            console.error('Login failed:', error);
            setIsAuthenticated(false);
            setUser(null);
            localStorage.removeItem('accessToken');
            localStorage.removeItem('refreshToken');
            throw error;
        } finally {
            setIsLoading(false);
        }
    };

    const logout = () => {
        console.log('Logging out...');
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        setIsAuthenticated(false);
        setUser(null);
    };

    const setToken = (token: string | null) => {
        if (token) {
            localStorage.setItem('accessToken', token);
            setIsAuthenticated(true);
        } else {
            logout();
        }
    }

    const authContextValue: AuthContextType = {
        isAuthenticated,
        isLoading,
        login,
        logout,
        user,
        setToken
    };

    return (
        <AuthContext.Provider value={authContextValue}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};
