import React, { useEffect } from "react";
import styled, { css, keyframes } from "styled-components";
import { Theme } from "../theme";
import { useConversation } from "../context/ConversationContext";

// Define the Patient type based on Prisma schema
interface Patient {
    id: string;
    firstName: string;
    lastName: string;
    dateOfBirth: string; // Assuming date string
    // Add other patient fields if needed
}

// Update Conversation type to include the nested Patient object
interface Conversation {
    id: string;
    userId: string;
    patientId: string;
    startTime: string;
    endTime?: string | null;
    status: string;
    createdAt: string;
    updatedAt: string;
    patient: Patient; // Include the nested patient object
}

type ThemedProps = { theme: Theme };

const ListContainer = styled.div<ThemedProps>`
    display: flex;
    flex-direction: column;
    gap: ${({ theme }) => theme.spacing.sm};
`;

const Title = styled.h3<ThemedProps>`
    color: ${({ theme }) => theme.colors.text.muted};
    font-size: ${({ theme }) => theme.typography.sizes.sm};
    font-weight: ${({ theme }) => theme.typography.weights.medium};
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: ${({ theme }) => theme.spacing.md};
    text-align: left;
    padding-left: 0;
    margin-left: 0;
`;

const ListItem = styled.div<ThemedProps & { $isSelected?: boolean }>`
    padding: ${({ theme }) => theme.spacing.md};
    color: ${({ theme, $isSelected }) => ($isSelected ? theme.colors.text.primary : theme.colors.text.secondary)};
    cursor: pointer;
    border-radius: ${({ theme }) => theme.borderRadius.lg};
    transition: all 0.2s ease;
    display: flex;
    flex-direction: column;
    gap: ${({ theme }) => theme.spacing.xs};
    border: 1px solid transparent;
    background-color: ${({ theme, $isSelected }) => ($isSelected ? theme.colors.background.hover : "transparent")};

    &:hover {
        background-color: ${({ theme }) => theme.colors.background.hover};
        color: ${({ theme }) => theme.colors.text.primary};
    }

    ${({ $isSelected }) =>
        $isSelected &&
        css`
            border-left: 3px solid ${({ theme }) => theme.colors.dashboard.highlight};
            padding-left: calc(${({ theme }) => theme.spacing.md} - 3px);
        `}
`;

const ConversationName = styled.div<ThemedProps>`
    font-weight: ${({ theme }) => theme.typography.weights.medium};
    font-size: ${({ theme }) => theme.typography.sizes.sm};
`;

const ConversationDate = styled.div<ThemedProps>`
    color: ${({ theme }) => theme.colors.text.muted};
    font-size: ${({ theme }) => theme.typography.sizes.xs};
`;

const EmptyState = styled.div<ThemedProps>`
    text-align: center;
    padding: ${({ theme }) => theme.spacing.xl};
    color: ${({ theme }) => theme.colors.text.muted};
    font-size: ${({ theme }) => theme.typography.sizes.sm};
`;

const RefreshButton = styled.button<ThemedProps>`
    margin-top: ${({ theme }) => theme.spacing.md};
    padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
    background-color: ${({ theme }) => theme.colors.background.secondary};
    color: ${({ theme }) => theme.colors.text.primary};
    border: none;
    border-radius: ${({ theme }) => theme.borderRadius.md};
    cursor: pointer;
    font-size: ${({ theme }) => theme.typography.sizes.xs};
    transition: all 0.2s ease;

    &:hover {
        background-color: ${({ theme }) => theme.colors.background.hover};
    }
`;

const LoadingIndicator = styled.div<ThemedProps>`
    text-align: center;
    padding: ${({ theme }) => theme.spacing.md};
    color: ${({ theme }) => theme.colors.text.muted};
    font-size: ${({ theme }) => theme.typography.sizes.sm};
`;

// Add a spinner animation
const spin = keyframes`
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
`;

const RefreshIndicator = styled.div<ThemedProps>`
    position: absolute;
    top: 15px;
    right: 15px;
    width: 16px;
    height: 16px;
    border: 2px solid ${({ theme }) => theme.colors.text.muted}30;
    border-top: 2px solid ${({ theme }) => theme.colors.text.muted};
    border-radius: 50%;
    animation: ${spin} 1s linear infinite;
`;

const ConversationList: React.FC = () => {
    // Get conversations and related functions from the context
    const { 
        conversations, 
        selectedConversationId, 
        selectConversation,
        fetchConversations,
        isLoading,
        isRefreshing
    } = useConversation(); 

    // Debug logging for conversations
    useEffect(() => {
        console.log("[ConversationList] Updated conversations:", conversations);
    }, [conversations]);

    // Log render count to track component updates
    useEffect(() => {
        console.log("[ConversationList] Component rendered");
    });

    const formatDateTime = (isoString: string | Date, options: Intl.DateTimeFormatOptions = {}) => {
        try {
            const date = typeof isoString === "string" ? new Date(isoString) : isoString;
            const defaultOptions: Intl.DateTimeFormatOptions = {
                year: "numeric",
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
                hour12: true,
            };
            return date.toLocaleString(undefined, { ...defaultOptions, ...options });
        } catch (e) {
            return String(isoString);
        }
    };

    const handleRefresh = () => {
        console.log("[ConversationList] Manual refresh requested");
        fetchConversations();
    };

    return (
        <div style={{ position: 'relative' }}>
            {isRefreshing && <RefreshIndicator />}
            
            {isLoading ? (
                <LoadingIndicator>Loading conversations...</LoadingIndicator>
            ) : (
                <ListContainer>
                    {conversations.length > 0 ? (
                        conversations.map((conv) => (
                            <ListItem
                                key={conv.id}
                                $isSelected={selectedConversationId === conv.id}
                                onClick={() => {
                                    console.log("[ConversationList] Clicked conversation:", conv);
                                    if (selectedConversationId !== conv.id) {
                                        selectConversation(conv);
                                    }
                                }}
                            >
                                <ConversationName>
                                    {conv.patient.firstName} {conv.patient.lastName}
                                </ConversationName>
                                <ConversationDate>{formatDateTime(conv.startTime)}</ConversationDate>
                            </ListItem>
                        ))
                    ) : (
                        <EmptyState>
                            No previous sessions found.
                            <RefreshButton onClick={handleRefresh}>Refresh</RefreshButton>
                        </EmptyState>
                    )}
                    {conversations.length > 0 && (
                        <RefreshButton onClick={handleRefresh}>
                            {isRefreshing ? 'Refreshing...' : 'Refresh Conversations'}
                        </RefreshButton>
                    )}
                </ListContainer>
            )}
        </div>
    );
};

export default React.memo(ConversationList);
