import React from "react";
import styled, { useTheme } from "styled-components";
import { useNavigate } from "react-router-dom"; // Import useNavigate
import { Theme } from "../theme";
import { useAuth } from "../context/AuthContext"; // Import useAuth
import { useWebSocket } from "../hooks/useWebSocket"; // Import the WebSocket hook


type ThemedProps = { theme: Theme };

const LayoutContainer = styled.div<ThemedProps>`
    display: flex;
    flex-direction: column; // Changed to column layout
    height: 100vh;
    background-color: ${({ theme }) => theme.colors.background.primary};
    color: ${({ theme }) => theme.colors.text.primary};
`;

// --- Topbar ---
const Topbar = styled.header<ThemedProps>`
    width: 100%;
    height: 60px;
    background-color: ${({ theme }) => theme.colors.background.primary};
    border-bottom: 1px solid ${({ theme }) => theme.colors.border.light};
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 ${({ theme }) => theme.spacing.xl};
    flex-shrink: 0; // Prevent shrinking
`;

const Logo = styled.div<ThemedProps>`
    font-size: ${({ theme }) => theme.typography.sizes.lg};
    font-weight: ${({ theme }) => theme.typography.weights.bold};
    color: ${({ theme }) => theme.colors.text.primary};
    letter-spacing: -0.03em;
`;

const LogoutButton = styled.button<ThemedProps>`
    padding: ${({ theme }) => theme.spacing.xs} ${({ theme }) => theme.spacing.md};
    background-color: transparent;
    color: ${({ theme }) => theme.colors.text.primary};
    border: 1px solid ${({ theme }) => theme.colors.text.primary};
    border-radius: 4px;
    cursor: pointer;
    font-size: ${({ theme }) => theme.typography.sizes.sm};
    font-weight: ${({ theme }) => theme.typography.weights.medium};
    transition: all 0.15s ease;

    &:hover {
        background-color: ${({ theme }) => theme.colors.text.primary};
        color: ${({ theme }) => theme.colors.background.primary};
    }
`;

// --- Main Content Area (Wrapper for Columns) ---
const MainContentArea = styled.div`
    display: flex;
    flex: 1; // Takes remaining height
    overflow: hidden; // Prevent container scrollbars
`;

// --- Left Column (Sidebar) ---
const LeftColumn = styled.aside<ThemedProps>`
    width: 280px; // Keep conversation list width fixed
    background-color: ${({ theme }) => theme.colors.background.sidebar};
    border-right: 1px solid ${({ theme }) => theme.colors.border.light};
    display: flex;
    flex-direction: column;
    overflow: hidden;
`;

// LeftColumnHeader removed

const LeftColumnContent = styled.div<ThemedProps>`
    flex: 1;
    overflow-y: auto;
    padding: ${({ theme }) => theme.spacing.sm};

    /* Custom scrollbar */
    &::-webkit-scrollbar {
        width: 6px;
    }
    &::-webkit-scrollbar-track {
        background: ${({ theme }) => theme.colors.background.sidebar};
    }
    &::-webkit-scrollbar-thumb {
        background: ${({ theme }) => theme.colors.border.light};
        border-radius: ${({ theme }) => theme.borderRadius.full};
    }
`;

// --- Status Footer (Bottom Left) ---
const StatusFooter = styled.footer<ThemedProps>`
    padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
    border-top: 1px solid ${({ theme }) => theme.colors.border.light};
    font-size: ${({ theme }) => theme.typography.sizes.xs};
    color: ${({ theme }) => theme.colors.text.muted};
    display: flex;
    align-items: center;
    gap: ${({ theme }) => theme.spacing.sm};
    flex-shrink: 0; // Prevent shrinking
    min-height: 30px; // Ensure it has some height
`;

const StatusIndicator = styled.div<{ $isConnected: boolean, theme: any }>`
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background-color: ${({ $isConnected, theme }) => ($isConnected ? theme.colors.status.success : theme.colors.status.error)};
    transition: background-color 0.3s ease;
`;

// --- Middle Column ---
const MiddleColumn = styled.main<ThemedProps>`
    flex: 1; // Takes up the main space
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background-color: ${({ theme }) => theme.colors.background.primary};
`;

// --- Right Column ---
const RightColumn = styled.aside<ThemedProps>`
    width: 320px; // Fixed width for actions
    // background-color: removed
    border-left: 1px solid ${({ theme }) => theme.colors.border.light};
    display: flex;
    flex-direction: column;
    overflow: hidden;
`;

const RightColumnHeader = styled.div<ThemedProps>`
    min-height: 64px; // Match potential header height
    padding: ${({ theme }) => theme.spacing.lg};
    border-bottom: 1px solid ${({ theme }) => theme.colors.border.light};
    color: ${({ theme }) => theme.colors.text.muted};
    font-size: ${({ theme }) => theme.typography.sizes.sm};
    font-weight: ${({ theme }) => theme.typography.weights.medium};
    text-transform: uppercase;
    letter-spacing: 0.05em;
    flex-shrink: 0; // Prevent shrinking
`;

const RightColumnContent = styled.div<ThemedProps>`
    flex: 1;
    overflow-y: auto;
    padding: ${({ theme }) => theme.spacing.sm};

    /* Custom scrollbar */
    &::-webkit-scrollbar {
        width: 6px;
    }
    &::-webkit-scrollbar-track {
        background: ${({ theme }) => theme.colors.background.secondary}; // Still needed for scroll track
    }
    &::-webkit-scrollbar-thumb {
        background: ${({ theme }) => theme.colors.border.light};
        border-radius: ${({ theme }) => theme.borderRadius.full};
    }
`;

// Component to render the combined status
const CombinedStatus: React.FC = () => {
    const { isConnected: isWsConnected, error: wsError } = useWebSocket();
    const theme = useTheme(); // Get theme from context
    
    // Removed RTC status state
    // const [rtcStatus, setRtcStatus] = useState<RtcStatus>('idle');
    // const [rtcError, setRtcError] = useState<Error | null>(null);

    // Removed effect for RTC status updates via window object
    // useEffect(() => {
    //     // Define the global function that ChatInterface will call
    //     // @ts-ignore - We will handle the type error safely
    //     window.updateRtcStatus = (status: RtcStatus, error: Error | null) => {
    //         console.log(`[Dashboard] RTC status update received: ${status}`);
    //         setRtcStatus(status);
    //         setRtcError(error);
    //     };
    //     
    //     return () => {
    //         // Clean up when component unmounts
    //         // @ts-ignore
    //         window.updateRtcStatus = undefined;
    //     };
    // }, []);

    // --- WebSocket Status ---
    let wsStatusText = "Backend: Connecting...";
    let wsConnected = false;
    if (wsError) {
        wsStatusText = "Backend: Error";
    } else if (isWsConnected) {
        wsStatusText = "Backend: Connected";
        wsConnected = true;
    }

    // Removed RTC Status Text Logic
    // // --- RTC Status ---
    // let rtcStatusText = "Model: Idle";
    // if (rtcError) {
    //     rtcStatusText = `Model: Error`;
    // } else {
    //     switch (rtcStatus) {
    //         case 'connecting': rtcStatusText = "Model: Connecting..."; break;
    //         case 'connected': rtcStatusText = "Model: Connected"; break;
    //         case 'failed': rtcStatusText = "Model: Failed"; break;
    //         case 'disconnected': rtcStatusText = "Model: Disconnected"; break;
    //         case 'closed': rtcStatusText = "Model: Closed"; break;
    //         default: rtcStatusText = "Model: Idle";
    //     }
    // }

    return (
        <StatusFooter>
            {/* WebSocket Status */}
            <StatusIndicator $isConnected={wsConnected} theme={theme} />
            <span>{wsStatusText}</span>

            {/* Removed RTC Status Display */}
            {/* // Separator */}
            {/* <span style={{ margin: '0 4px' }}>|</span> */}

            {/* // RTC Status */}
            {/* <RtcStatusIndicatorDot $status={rtcStatus} /> */}
            {/* <span>{rtcStatusText}</span> */}
        </StatusFooter>
    );
};

interface DashboardLayoutProps {
    leftColumnContent: React.ReactNode;
    middleColumnContent: React.ReactNode;
    rightColumnContent: React.ReactNode;
}

const DashboardLayout: React.FC<DashboardLayoutProps> = ({ leftColumnContent, middleColumnContent, rightColumnContent }) => {
    const { logout } = useAuth();
    const navigate = useNavigate();

    const handleLogout = () => {
        logout();
        navigate("/");
    };

    return (
        <LayoutContainer>
            {/* Removed Topbar related lines */}
            <MainContentArea> 
                <LeftColumn>
                    <LeftColumnContent>{leftColumnContent}</LeftColumnContent>
                    <CombinedStatus />
                </LeftColumn>
                <MiddleColumn>{middleColumnContent}</MiddleColumn>
                <RightColumn>
                    <RightColumnHeader>Actions</RightColumnHeader>
                    <RightColumnContent>{rightColumnContent}</RightColumnContent>
                </RightColumn>
            </MainContentArea>
        </LayoutContainer>
    );
};

export default DashboardLayout;
