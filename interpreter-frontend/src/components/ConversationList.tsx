import React, { useState, useEffect } from "react";
import styled, { css } from "styled-components";
import { Theme } from "../theme";
import NewSessionModal from "./NewSessionModal";
import { useWebSocket } from "../hooks/useWebSocket";
import { useError } from "../context/ErrorContext";
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

const StartSessionButton = styled.button<ThemedProps>`
    display: flex;
    align-items: center;
    justify-content: center;
    gap: ${({ theme }) => theme.spacing.sm};
    width: 100%;
    padding: ${({ theme }) => theme.spacing.md};
    margin-top: ${({ theme }) => theme.spacing.lg};
    background-color: transparent;
    color: ${({ theme }) => theme.colors.text.primary};
    border: 1px solid ${({ theme }) => theme.colors.text.primary};
    border-radius: ${({ theme }) => theme.borderRadius.lg};
    cursor: pointer;
    font-size: ${({ theme }) => theme.typography.sizes.sm};
    font-weight: ${({ theme }) => theme.typography.weights.medium};
    transition: all 0.2s ease;

    &:hover {
        background-color: ${({ theme }) => theme.colors.text.primary};
        color: ${({ theme }) => theme.colors.background.primary};
        transform: translateY(-1px);
    }

    &:active {
        transform: translateY(0);
        opacity: 0.8;
    }
`;

const EmptyState = styled.div<ThemedProps>`
    text-align: center;
    padding: ${({ theme }) => theme.spacing.xl};
    color: ${({ theme }) => theme.colors.text.muted};
    font-size: ${({ theme }) => theme.typography.sizes.sm};
`;

interface PatientData {
    firstName: string;
    lastName: string;
    dob: string;
}

const ConversationList: React.FC = () => {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const { sendMessage, isConnected, lastMessage } = useWebSocket();
    const { showError } = useError();
    const { selectedConversationId, selectConversation } = useConversation();
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [hasRequestedConversations, setHasRequestedConversations] = useState(false);

    // Effect to request conversations when connected
    useEffect(() => {
        if (isConnected && !hasRequestedConversations) {
            console.log("WebSocket connected, requesting conversations...");
            sendMessage({ type: "get_conversations" });
            setHasRequestedConversations(true);
        }
        if (!isConnected) {
            setHasRequestedConversations(false);
            setConversations([]);
        }
    }, [isConnected, hasRequestedConversations, sendMessage]);

    // Effect to handle incoming messages
    useEffect(() => {
        if (lastMessage) {
            try {
                const message = JSON.parse(lastMessage);
                console.log("Received WebSocket message:", message.type, message.payload);

                if (message.type === "conversation_list" && Array.isArray(message.payload)) {
                    console.log("Updating conversation list state.");
                    setConversations(message.payload as Conversation[]);
                } else if (message.type === "session_started" && message.payload) {
                    const { conversationId } = message.payload;
                    const newConversationObject: Conversation = message.payload;
                    
                    console.log(`New session started successfully! ConvID: ${conversationId}`);
                    
                    sendMessage({ type: "get_conversations" }); 
                    
                    if (newConversationObject && newConversationObject.id === conversationId) {
                         console.log("Auto-selecting newly started conversation:", newConversationObject);
                         selectConversation(newConversationObject);
                    } else {
                         console.warn("session_started payload did not contain full conversation object for auto-selection.");
                    }
                    
                } else if (message.type === "conversation_selected" && message.payload) {
                    const { conversationId, isActive } = message.payload;
                    
                    console.log(`Conversation selected confirmation received: ID=${conversationId}, Active=${isActive}`);
                    
                } else {
                    // console.log("Ignoring message type:", message.type);
                }
            } catch (error) {
                console.error("Error parsing WebSocket message:", error, "Raw message:", lastMessage);
            }
        }
    }, [lastMessage, sendMessage, selectConversation]);

    const handleOpenModal = () => {
        setIsModalOpen(true);
    };

    const handleCloseModal = () => {
        setIsModalOpen(false);
    };

    const handleStartSession = async (patientData: PatientData) => {
        if (!isConnected) {
            showError("Cannot start session: Not connected to server.", "warning");
            handleCloseModal();
            return;
        }

        console.log("Starting new session for:", patientData);
        const messageToSend = {
            type: "start_new_session",
            payload: patientData,
        };
        sendMessage(messageToSend);

        handleCloseModal();
    };

    // Helper to format date/time
    const formatDateTime = (isoString: string | Date, options: Intl.DateTimeFormatOptions = {}) => {
        try {
            const date = typeof isoString === "string" ? new Date(isoString) : isoString;
            // Add default options if none provided
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
            return String(isoString); // Fallback
        }
    };

    return (
        <>
            <Title>Previous Sessions</Title>
            <ListContainer>
                {conversations.length > 0 ? (
                    conversations
                        .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime()) // Sort newest first
                        .map((conv) => (
                            <ListItem
                                key={conv.id}
                                $isSelected={selectedConversationId === conv.id}
                                onClick={() => {
                                    console.log("Clicked conversation:", conv);
                                    selectConversation(conv); // Pass the full conversation object
                                }}
                            >
                                <ConversationName>
                                    {conv.patient.firstName} {conv.patient.lastName}
                                </ConversationName>
                                <ConversationDate>{formatDateTime(conv.startTime)}</ConversationDate>
                            </ListItem>
                        ))
                ) : (
                    <EmptyState>No previous sessions found.</EmptyState>
                )}
            </ListContainer>

            <StartSessionButton onClick={handleOpenModal}>
                <span>+</span> New Session
            </StartSessionButton>

            <NewSessionModal
                isOpen={isModalOpen}
                onClose={handleCloseModal}
                onStartSession={handleStartSession}
            />
        </>
    );
};

export default ConversationList;
