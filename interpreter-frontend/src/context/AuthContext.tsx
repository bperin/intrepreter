import React, { createContext, useState, useContext, useEffect, ReactNode } from "react";
import apiClient, { setAuthContext } from '../api/apiClient';

// Define expected login response structure
interface LoginApiResponse {
    accessToken: string;
    refreshToken: string;
    userId: string;
    username: string;
    // Add other fields if the backend might return them
}

export interface UserProfile {
    id: string;
    username: string;
    // Add other fields if needed
}

export interface AuthContextType {
    isAuthenticated: boolean;
    isLoading: boolean;
    login: (username: string, pass: string) => Promise<void>;
    logout: () => void;
    user: UserProfile | null; // Use specific type
    setToken: (token: string | null) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [user, setUser] = useState<UserProfile | null>(null); // Use specific type

    // Function to fetch user profile
    const fetchUserProfile = async () => {
        console.log("Attempting to fetch user profile...");
        try {
            const response = await apiClient.get<UserProfile>('/auth/me');
            setUser(response.data);
            setIsAuthenticated(true); // Ensure authenticated state is set
            console.log("User profile fetched:", response.data);
        } catch (error) {
            console.error("Failed to fetch user profile:", error);
            // If fetching profile fails (e.g., invalid token), log out
            logout();
        }
    };

    useEffect(() => {
        setAuthContext(authContextValue);
    }, []);

    // Check token and fetch profile on initial load
    useEffect(() => {
        const token = localStorage.getItem('accessToken');
        if (token) {
            console.log("Token found on initial load, fetching profile...");
            // apiClient interceptor will add the token
            fetchUserProfile().finally(() => setIsLoading(false));
        } else {
            setIsLoading(false); // No token, not loading
        }
    }, []);

    const login = async (username: string, pass: string): Promise<void> => {
        setIsLoading(true);
        setUser(null); // Clear previous user state
        try {
            // Use the locally defined interface for the expected response type
            const response = await apiClient.post<LoginApiResponse>('/auth/login', { username, password: pass }); 
            const { accessToken, refreshToken, userId, username: responseUsername } = response.data;

            if (!accessToken || !refreshToken || !userId || !responseUsername) {
                throw new Error("Incomplete login response from server.");
            }

            localStorage.setItem('accessToken', accessToken);
            localStorage.setItem('refreshToken', refreshToken);
            setUser({ id: userId, username: responseUsername }); // Set user state immediately
            setIsAuthenticated(true);
            console.log('Login successful, user state set.');

        } catch (error) {
            console.error('Login failed:', error);
            logout(); // Use logout to clear state and tokens on failed login
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
        // No need to call apiClient here, interceptor handles token removal indirectly
    };

    const setToken = (token: string | null) => {
        if (token) {
            localStorage.setItem('accessToken', token);
            setIsAuthenticated(true);
            // Re-fetch profile if token is set by interceptor (means refresh happened)
            fetchUserProfile();
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
