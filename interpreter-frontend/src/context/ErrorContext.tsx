import React, { createContext, useContext, ReactNode, useCallback } from "react";
import { ToastContainer, toast, ToastOptions } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

type ErrorType = "info" | "success" | "warning" | "error" | "default";

interface ErrorContextType {
    showError: (message: string, type?: ErrorType, options?: ToastOptions) => void;
    showApiError: (error: unknown, defaultMessage?: string) => void;
}

const ErrorContext = createContext<ErrorContextType | undefined>(undefined);

interface ErrorProviderProps {
    children: ReactNode;
}

// Basic styling for toast matching the dark theme (adjust as needed)
const toastStyle: React.CSSProperties = {
    backgroundColor: "#2A2A2A",
    color: "#FFFFFF",
};

export const ErrorProvider: React.FC<ErrorProviderProps> = ({ children }) => {
    const showError = useCallback((message: string, type: ErrorType = "error", options: ToastOptions = {}) => {
        const toastOptions: ToastOptions = {
            position: "top-right",
            autoClose: 5000,
            hideProgressBar: false,
            closeOnClick: true,
            pauseOnHover: true,
            draggable: true,
            progress: undefined,
            theme: "dark", // Use dark theme
            style: toastStyle, // Apply custom styles
            ...options, // Merge with user-provided options
        };

        switch (type) {
            case "success":
                toast.success(message, toastOptions);
                break;
            case "warning":
                toast.warning(message, toastOptions);
                break;
            case "info":
                toast.info(message, toastOptions);
                break;
            case "error":
            default:
                toast.error(message, toastOptions);
                break;
        }
    }, []);

    const showApiError = useCallback(
        (error: unknown, defaultMessage: string = "An API error occurred") => {
            let message = defaultMessage;
            if (axios.isAxiosError(error)) {
                if (error.response?.data?.message) {
                    message = error.response.data.message;
                } else if (error.request) {
                    message = "Could not connect to the server.";
                } else {
                    message = error.message;
                }
            } else if (error instanceof Error) {
                message = error.message;
            }
            showError(message, "error"); // Show as error toast
        },
        [showError]
    );

    return (
        <ErrorContext.Provider value={{ showError, showApiError }}>
            {children}
            {/* ToastContainer needs to be rendered within the provider */}
            <ToastContainer />
        </ErrorContext.Provider>
    );
};

export const useError = (): ErrorContextType => {
    const context = useContext(ErrorContext);
    if (context === undefined) {
        throw new Error("useError must be used within an ErrorProvider");
    }
    return context;
};

// Import axios directly here for the type guard
import axios from "axios";
export { axios };
