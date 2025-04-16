import React, { createContext, useState, useContext, useEffect, ReactNode } from "react";

interface AuthContextType {
    accessToken: string | null;
    refreshToken: string | null;
    isAuthenticated: boolean;
    login: (access: string, refresh: string) => void;
    logout: () => void;
    setTokens: (access: string | null, refresh: string | null) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
    children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
    const [accessToken, setAccessToken] = useState<string | null>(() => localStorage.getItem("accessToken"));
    const [refreshToken, setRefreshToken] = useState<string | null>(() => localStorage.getItem("refreshToken"));

    const isAuthenticated = !!accessToken;

    // Load tokens from localStorage on initial render
    useEffect(() => {
        const storedAccess = localStorage.getItem("accessToken");
        const storedRefresh = localStorage.getItem("refreshToken");
        if (storedAccess) {
            setAccessToken(storedAccess);
        }
        if (storedRefresh) {
            setRefreshToken(storedRefresh);
        }
    }, []);

    const login = (access: string, refresh: string) => {
        localStorage.setItem("accessToken", access);
        localStorage.setItem("refreshToken", refresh);
        setAccessToken(access);
        setRefreshToken(refresh);
    };

    const logout = () => {
        localStorage.removeItem("accessToken");
        localStorage.removeItem("refreshToken");
        setAccessToken(null);
        setRefreshToken(null);
        // Optionally redirect to login page here or let ProtectedRoute handle it
    };

    const setTokens = (access: string | null, refresh: string | null) => {
        if (access) {
            localStorage.setItem("accessToken", access);
        } else {
            localStorage.removeItem("accessToken");
        }
        if (refresh) {
            localStorage.setItem("refreshToken", refresh);
        } else {
            localStorage.removeItem("refreshToken");
        }
        setAccessToken(access);
        setRefreshToken(refresh);
    };

    return <AuthContext.Provider value={{ accessToken, refreshToken, isAuthenticated, login, logout, setTokens }}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextType => {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error("useAuth must be used within an AuthProvider");
    }
    return context;
};
