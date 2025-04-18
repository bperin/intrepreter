import axios, { AxiosError, InternalAxiosRequestConfig } from "axios";

// Restore VITE_APP_BACKEND_URL
const RAW_BACKEND_URL = import.meta.env.VITE_APP_BACKEND_URL;

if (!RAW_BACKEND_URL) {
  throw new Error("Configuration Error: VITE_APP_BACKEND_URL environment variable is not set.");
}

// Construct the final API base URL including the /api/v1 prefix
const API_BASE_URL = RAW_BACKEND_URL.replace(/\/$/, "") + '/api/v1';

console.log(`[API Config] Using API Base URL: ${API_BASE_URL}`);

// Create Axios instance
const api = axios.create({
    baseURL: API_BASE_URL, // Use the constructed URL with the prefix
});

let isRefreshing = false;
let failedQueue: { resolve: (value: unknown) => void; reject: (reason?: any) => void }[] = [];

const processQueue = (error: AxiosError | null, token: string | null = null) => {
    failedQueue.forEach((prom) => {
        if (error) {
            prom.reject(error);
        } else {
            prom.resolve(token);
        }
    });
    failedQueue = [];
};

// Request interceptor to add the auth token header and handle path compatibility
api.interceptors.request.use(
    (config: InternalAxiosRequestConfig) => {
        // Add auth token
        const accessToken = localStorage.getItem("accessToken");
        if (accessToken) {
            config.headers.Authorization = `Bearer ${accessToken}`;
        }
        
        return config;
    },
    (error: AxiosError) => {
        return Promise.reject(error);
    }
);

// Response interceptor to handle token refresh
api.interceptors.response.use(
    (response) => {
        // If request is successful, just return the response
        return response;
    },
    async (error: AxiosError) => {
        const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

        // Check if it's a 401 error and not a retry attempt and not the refresh token request itself
        if (error.response?.status === 401 && !originalRequest._retry && originalRequest.url !== "/auth/refresh") {
            if (isRefreshing) {
                // If already refreshing, queue the original request
                return new Promise((resolve, reject) => {
                    failedQueue.push({ resolve, reject });
                })
                    .then((token) => {
                        if (originalRequest.headers) {
                            originalRequest.headers["Authorization"] = "Bearer " + token;
                        }
                        return api(originalRequest); // Retry with new token
                    })
                    .catch((err) => {
                        return Promise.reject(err); // If refresh fails, reject the queued request
                    });
            }

            originalRequest._retry = true;
            isRefreshing = true;

            const refreshToken = localStorage.getItem("refreshToken");

            if (!refreshToken) {
                // No refresh token, logout required
                console.error("No refresh token available, redirecting to login.");
                // TODO: Better logout handling (e.g., call logout from AuthContext)
                localStorage.removeItem("accessToken");
                localStorage.removeItem("refreshToken");
                window.location.href = "/login";
                processQueue(error, null);
                return Promise.reject(error);
            }

            try {
                const response = await axios.post(`${API_BASE_URL}/auth/refresh`, { refreshToken });
                const { accessToken: newAccessToken } = response.data;

                // Update stored tokens (use AuthContext if possible, or localStorage directly)
                localStorage.setItem("accessToken", newAccessToken);
                // TODO: Update AuthContext state

                // Update the header of the original request
                if (originalRequest.headers) {
                    originalRequest.headers["Authorization"] = `Bearer ${newAccessToken}`;
                }
                processQueue(null, newAccessToken); // Process queue with new token
                return api(originalRequest); // Retry the original request
            } catch (refreshError: any) {
                console.error("Unable to refresh token", refreshError);
                // Refresh failed, logout required
                // TODO: Better logout handling (e.g., call logout from AuthContext)
                localStorage.removeItem("accessToken");
                localStorage.removeItem("refreshToken");
                window.location.href = "/login";
                processQueue(refreshError as AxiosError, null);
                return Promise.reject(refreshError);
            } finally {
                isRefreshing = false;
            }
        }

        // For errors other than 401, just reject
        return Promise.reject(error);
    }
);

export const getMedicalHistory = async (conversationId: string): Promise<{ content: string }> => {
    try {
        const response = await api.get(`/conversations/${conversationId}/medical-history`); // Keep relative path
        return response.data;
    } catch (error) {
        console.error(`[API] Error fetching medical history for conversation ${conversationId}:`, error);
        throw error;
    }
};

export default api;