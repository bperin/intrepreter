import React, { useState, useCallback } from "react";
import styled, { useTheme } from "styled-components";
import { useNavigate } from "react-router-dom"; // Import useNavigate
import { Theme } from "../theme";
import { useAuth } from "../context/AuthContext"; // Import useAuth
import { useWebSocket } from "../hooks/useWebSocket"; // Import the WebSocket hook
import CommandHelpModal from "./CommandHelpModal"; // Import the modal component
import NewSessionModal from "./NewSessionModal"; // Import NewSessionModal
import { useConversation } from "../context/ConversationContext"; // Needed for selectConversation

type ThemedProps = { theme: Theme };

const LayoutContainer = styled.div<ThemedProps>`
    display: flex;
    flex-direction: column; // Changed to column layout
    height: 100vh;
    background-color: ${({ theme }) => theme.colors.background.primary};
    color: ${({ theme }) => theme.colors.text.primary};
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

// Renamed from LeftColumnHeader to ColumnHeader (more generic)
const ColumnHeader = styled.div<ThemedProps>`
    height: 64px; // Ensure consistent height for headers
    padding: ${({ theme }) => theme.spacing.lg};
    border-bottom: 1px solid ${({ theme }) => theme.colors.border.light};
    color: ${({ theme }) => theme.colors.text.muted};
    font-size: ${({ theme }) => theme.typography.sizes.sm};
    font-weight: ${({ theme }) => theme.typography.weights.medium};
    text-transform: uppercase;
    letter-spacing: 0.05em;
    flex-shrink: 0; // Prevent shrinking
    display: flex; // Added for alignment
    align-items: center; // Added for vertical alignment
    justify-content: space-between; // Added for spacing title and button
`;

// Button for starting a new session, styled similarly to HeaderHelpButton
const NewSessionButton = styled.button<ThemedProps>`
    // Adopt styles similar to LogoutButton but fit sidebar context
    background-color: transparent;
    color: ${({ theme }) => theme.colors.text.secondary}; // Use secondary text color for sidebar
    border: 1px solid ${({ theme }) => theme.colors.text.secondary}80; // Lighter border to match muted header text
    border-radius: ${({ theme }) => theme.borderRadius.md};
    padding: ${({ theme }) => theme.spacing.xs} ${({ theme }) => theme.spacing.sm}; // Smaller padding
    font-size: ${({ theme }) => theme.typography.sizes.xs}; // Smaller font size
    font-weight: ${({ theme }) => theme.typography.weights.medium};
    cursor: pointer;
    transition: all 0.2s ease;
    line-height: 1;
    margin-left: ${({ theme }) => theme.spacing.sm}; // Keep margin from title

    &:hover {
        background-color: ${({ theme }) => theme.colors.text.secondary}; // Use secondary color for hover background
        color: ${({ theme }) => theme.colors.background.sidebar}; // Use sidebar background for text on hover
        border-color: ${({ theme }) => theme.colors.text.secondary};
    }
`;

// New Help Button specific for this layout
const HeaderHelpButton = styled.button<ThemedProps>`
    background: none;
    border: 1px solid transparent; // Transparent border initially
    color: ${({ theme }) => theme.colors.text.secondary};
    border-radius: 50%;
    width: 24px; // Slightly smaller
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    font-size: ${({ theme }) => theme.typography.sizes.sm}; // Smaller font
    font-weight: ${({ theme }) => theme.typography.weights.bold};
    line-height: 1;
    padding: 0;
    transition: all 0.2s ease;
    margin-left: ${({ theme }) => theme.spacing.sm}; // Add space between title and button

    &:hover {
        background-color: ${({ theme }) => theme.colors.background.hover};
        color: ${({ theme }) => theme.colors.text.primary};
        border-color: ${({ theme }) => theme.colors.text.secondary}40;
        transform: scale(1.1);
    }
`;

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

// Removed RightColumnHeader (using generic ColumnHeader)

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

interface PatientData {
    firstName: string;
    lastName: string;
    dob: string;
}

interface DashboardLayoutProps {
    leftColumnContent: React.ReactNode;
    middleColumnContent: React.ReactNode;
    rightColumnContent: React.ReactNode;
}

const DashboardLayout: React.FC<DashboardLayoutProps> = ({ 
    leftColumnContent, 
    middleColumnContent, 
    rightColumnContent
}) => {
    const { logout } = useAuth(); // Get logout function
    const navigate = useNavigate(); // Get navigate function
    const { fetchConversations } = useConversation();
    const [isHelpModalOpen, setIsHelpModalOpen] = useState(false);
    const [isNewSessionModalOpen, setIsNewSessionModalOpen] = useState(false);
    
    const handleOpenNewSessionModal = useCallback(() => {
        console.log("[DashboardLayout] Opening new session modal");
        setIsNewSessionModalOpen(true);
    }, []);
    
    const handleCloseNewSessionModal = useCallback(() => {
        console.log("[DashboardLayout] Closing new session modal");
        setIsNewSessionModalOpen(false);
    }, []);
    
    const handleSessionCreated = useCallback(() => {
        console.log("[DashboardLayout] New session created, refreshing conversations");
        // Use fetchConversations with a slight delay to ensure the backend has time to process
        setTimeout(() => {
            fetchConversations(); // Force a full refresh
        }, 500); // Small delay to ensure backend is ready
    }, [fetchConversations]);
    
    return (
        <LayoutContainer>
            {/* Topbar is now handled by AppLayout in App.tsx */}
            <MainContentArea>
                <LeftColumn>
                    <ColumnHeader>
                        Sessions
                        <NewSessionButton onClick={handleOpenNewSessionModal}>+ New</NewSessionButton>
                    </ColumnHeader>
                    
                    <LeftColumnContent>{leftColumnContent}</LeftColumnContent>
                    <StatusFooter>
                       <CombinedStatus />
                    </StatusFooter>
                </LeftColumn>
                <MiddleColumn>
                    <ColumnHeader>
                        Interaction
                        <HeaderHelpButton onClick={() => setIsHelpModalOpen(true)}>?</HeaderHelpButton>
                    </ColumnHeader>
                    {middleColumnContent} 
                </MiddleColumn>
                <RightColumn>
                    <ColumnHeader>
                        Actions & Notes
                    </ColumnHeader>
                    <RightColumnContent>{rightColumnContent}</RightColumnContent>
                </RightColumn>
            </MainContentArea>
            {/* Command Help Modal */}
            <CommandHelpModal isOpen={isHelpModalOpen} onClose={() => setIsHelpModalOpen(false)} />
            {/* New Session Modal */}
            <NewSessionModal 
                isOpen={isNewSessionModalOpen} 
                onClose={handleCloseNewSessionModal} 
                onSessionCreated={handleSessionCreated}
            />
        </LayoutContainer>
    );
};

// Keep the original CombinedStatus component
const CombinedStatus: React.FC = () => {
    const { isConnected: isWsConnected, error: wsError } = useWebSocket();
    const theme = useTheme();
    
    let statusText = "Connecting...";
    let isConnected = false;

    if (wsError) {
        statusText = `WebSocket Error: ${wsError.message.substring(0, 30)}...`;
        isConnected = false;
    } else if (isWsConnected) {
        statusText = "System Connected";
        isConnected = true;
    }

    return (
        <>
            <StatusIndicator $isConnected={isConnected} theme={theme} />
            <span>{statusText}</span>
        </>
    );
};

export default DashboardLayout;
