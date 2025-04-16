import React from "react";
import styled from "styled-components";
import { Theme } from "../theme";

type ThemedProps = { theme: Theme };

const ActionStreamContainer = styled.div<ThemedProps>`
    display: flex;
    flex-direction: column;
    gap: ${({ theme }) => theme.spacing.md};
    background-color: ${({ theme }) => theme.colors.background.primary};
    padding: ${({ theme }) => theme.spacing.md};
    border-radius: ${({ theme }) => theme.borderRadius.lg};
    border: 1px solid ${({ theme }) => theme.colors.border.light}40;
`;

// @ts-ignore - TS6133: Declared but value never read
const ActionItem = styled.div<ThemedProps>`
    background-color: ${({ theme }) => theme.colors.background.card};
    border-radius: ${({ theme }) => theme.borderRadius.lg};
    padding: ${({ theme }) => theme.spacing.md};
    border: 1px solid ${({ theme }) => theme.colors.border.light};
    color: ${({ theme }) => theme.colors.text.secondary};
`;

// @ts-ignore - TS6133: Declared but value never read
const ActionTitle = styled.h4<ThemedProps>`
    color: ${({ theme }) => theme.colors.text.primary};
    font-weight: ${({ theme }) => theme.typography.weights.medium};
    margin-bottom: ${({ theme }) => theme.spacing.sm};
`;

const EmptyState = styled.div<ThemedProps>`
    color: ${({ theme }) => theme.colors.text.muted};
    font-style: italic;
    text-align: center;
    padding: ${({ theme }) => theme.spacing.xl};
    border: 1px dashed ${({ theme }) => theme.colors.border.light}60;
    border-radius: ${({ theme }) => theme.borderRadius.lg};
`;

const ActionStream: React.FC = () => {
    // Empty state without placeholder content
    return (
        <ActionStreamContainer>
            <EmptyState>Actions detected during conversation will appear here.</EmptyState>
        </ActionStreamContainer>
    );
};

export default ActionStream;
