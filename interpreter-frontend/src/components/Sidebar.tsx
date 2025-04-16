import React, { useState, useCallback } from "react";
import styled from "styled-components";
import { Theme } from "../theme";
import ConversationList from "./ConversationList";
import { useConversation } from "../context/ConversationContext";

// ... (ThemedProps, SidebarContainer, Header, etc.) ...

type ThemedProps = { theme: Theme };

const SidebarContainer = styled.div<ThemedProps>`
    width: 300px;
    background-color: ${({ theme }) => theme.colors.background.secondary};
    border-right: 1px solid ${({ theme }) => theme.colors.border.light};
    display: flex;
    flex-direction: column;
    padding: ${({ theme }) => theme.spacing.md};
    height: 100%; // Ensure sidebar takes full height
`;

// --- New Container for Header + Button --- 
const ListHeaderContainer = styled.div<ThemedProps>`
    display: flex;
    justify-content: space-between; // Pushes items to ends
    align-items: center; // Vertically centers items
    padding: 0 ${({ theme }) => theme.spacing.md}; // Add some horizontal padding
    margin-bottom: ${({ theme }) => theme.spacing.sm}; // Space below header area
    flex-shrink: 0; // Prevent header from shrinking
`;
// -----------------------------------------

const Header = styled.h2<ThemedProps>`
    font-size: ${({ theme }) => theme.typography.sizes.lg};
    color: ${({ theme }) => theme.colors.text.primary};
    font-weight: ${({ theme }) => theme.typography.weights.bold};
    text-transform: uppercase;
    letter-spacing: 0.05em;
`;

// --- New Small Button Style (Inspired by HeaderHelpButton) ---
const SmallNewSessionButton = styled.button<ThemedProps>`
    background: none;
    border: 1px solid transparent; // Transparent border initially
    color: ${({ theme }) => theme.colors.text.secondary};
    border-radius: ${({ theme }) => theme.borderRadius.md}; // Use medium radius
    width: auto; // Allow width to adjust to content
    height: 26px; // Adjust height slightly
    padding: 0 ${({ theme }) => theme.spacing.sm}; // Horizontal padding
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    font-size: ${({ theme }) => theme.typography.sizes.sm}; 
    font-weight: ${({ theme }) => theme.typography.weights.medium}; // Medium weight
    line-height: 1;
    transition: all 0.2s ease;
    margin-left: ${({ theme }) => theme.spacing.sm}; // Space from header

    &:hover {
        background-color: ${({ theme }) => theme.colors.background.hover};
        color: ${({ theme }) => theme.colors.text.primary};
        border-color: ${({ theme }) => theme.colors.text.secondary}40;
    }
`;
// --------------------------------------------------------

// Assuming ConversationList needs to scroll
const ConversationListWrapper = styled.div`
    flex-grow: 1; // Allows the list to take available space
    overflow-y: auto; // Make the list scrollable
    margin-bottom: ${({ theme }) => theme.spacing.md}; // Add space before potential bottom elements
`;

// --- Add Props Interface for Sidebar --- 
interface SidebarProps {
  onOpenNewSessionModal?: () => void; // Optional callback prop
}
// ---------------------------------------

// Update component signature to accept props
const Sidebar: React.FC<SidebarProps> = ({ onOpenNewSessionModal }) => {
    const { selectConversation } = useConversation();

    // Update handler to call the prop if it exists
    const handleNewSessionClick = () => {
        if (onOpenNewSessionModal) {
            console.log("[Sidebar] Calling onOpenNewSessionModal prop.");
            onOpenNewSessionModal();
        } else {
            console.warn("[Sidebar] New Session button clicked, but no onOpenNewSessionModal handler provided.");
        }
    };

    return (
        <SidebarContainer>
            <ListHeaderContainer>
                <Header>CONVERSATIONS</Header>
                <SmallNewSessionButton onClick={handleNewSessionClick}>
                    + New Session
                </SmallNewSessionButton>
            </ListHeaderContainer>
            
            <ConversationListWrapper>
                <ConversationList />
            </ConversationListWrapper>
        </SidebarContainer>
    );
};

export default Sidebar; 