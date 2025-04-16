import React from "react";
import styled from "styled-components";
import { Theme } from "../theme";
import { 
    AggregatedAction, 
    NoteData, 
    FollowUpData, 
    PrescriptionData 
} from "../types/actions";
import { useActions } from "../context/ActionContext";
import { format } from "date-fns";

type ThemedProps = { theme: Theme };

const ActionStreamContainer = styled.div<ThemedProps>`
    display: flex;
    flex-direction: column;
    gap: ${({ theme }) => theme.spacing.md};
    background-color: ${({ theme }) => theme.colors.background.primary};
    padding: ${({ theme }) => theme.spacing.md};
    border-radius: ${({ theme }) => theme.borderRadius.lg};
    border: 1px solid ${({ theme }) => theme.colors.border.light}40;
    max-height: calc(100vh - 200px);
    overflow-y: auto;
`;

const ActionItem = styled.div<ThemedProps>`
    background-color: ${({ theme }) => theme.colors.background.card};
    border-radius: ${({ theme }) => theme.borderRadius.lg};
    padding: ${({ theme }) => theme.spacing.md};
    border: 1px solid ${({ theme }) => theme.colors.border.light};
    color: ${({ theme }) => theme.colors.text.secondary};
    transition: transform 0.2s ease-in-out;

    &:hover {
        transform: translateX(4px);
    }
`;

const ActionTitle = styled.h4<ThemedProps>`
    color: ${({ theme }) => theme.colors.text.primary};
    font-weight: ${({ theme }) => theme.typography.weights.medium};
    margin-bottom: ${({ theme }) => theme.spacing.sm};
    display: flex;
    align-items: center;
    gap: ${({ theme }) => theme.spacing.sm};
`;

const ActionIcon = styled.span`
    font-size: 1.2em;
`;

const ActionTime = styled.span<ThemedProps>`
    color: ${({ theme }) => theme.colors.text.muted};
    font-size: ${({ theme }) => theme.typography.sizes.sm};
    margin-left: auto;
`;

const ActionContent = styled.p<ThemedProps>`
    margin: 0;
    color: ${({ theme }) => theme.colors.text.secondary};
    font-size: ${({ theme }) => theme.typography.sizes.base};
`;

const ActionDetails = styled.ul<ThemedProps>`
    list-style: none;
    padding-left: 0;
    margin-top: ${({ theme }) => theme.spacing.sm};
    margin-bottom: 0;
`;

const ActionDetailItem = styled.li<ThemedProps>`
    font-size: ${({ theme }) => theme.typography.sizes.sm};
    color: ${({ theme }) => theme.colors.text.secondary};
    margin-bottom: ${({ theme }) => theme.spacing.xs};
    
    strong {
        color: ${({ theme }) => theme.colors.text.primary}B3;
    }
`;

const EmptyState = styled.div<ThemedProps>`
    color: ${({ theme }) => theme.colors.text.muted};
    font-style: italic;
    text-align: center;
    padding: ${({ theme }) => theme.spacing.xl};
    border: 1px dashed ${({ theme }) => theme.colors.border.light}60;
    border-radius: ${({ theme }) => theme.borderRadius.lg};
`;

const LoadingState = styled(EmptyState)`
    border-style: solid;
    animation: pulse 2s infinite;

    @keyframes pulse {
        0% { opacity: 1; }
        50% { opacity: 0.5; }
        100% { opacity: 1; }
    }
`;

const ErrorState = styled(EmptyState)`
    color: ${({ theme }) => theme.colors.status.error};
    border-color: ${({ theme }) => theme.colors.status.error}60;
`;

function isNoteData(data: any): data is NoteData {
  return typeof data?.content === 'string';
}

function isFollowUpData(data: any): data is FollowUpData {
  return typeof data?.duration === 'number' && typeof data?.unit === 'string';
}

function isPrescriptionData(data: any): data is PrescriptionData {
  return typeof data?.medicationName === 'string' && 
         typeof data?.dosage === 'string' && 
         typeof data?.frequency === 'string';
}

const ActionItemComponent: React.FC<{ action: AggregatedAction }> = ({ action }) => {
    let icon = '❓';
    let title = 'Unknown Action';
    let content = null;

    switch (action.type) {
        case 'note':
            icon = '📝';
            title = 'Note';
            if (isNoteData(action.data)) {
                content = <ActionContent>{action.data.content}</ActionContent>;
            }
            break;
        case 'followup':
            icon = '📅';
            title = 'Follow-up';
            if (isFollowUpData(action.data)) {
                const scheduledDate = action.data.scheduledFor ? new Date(action.data.scheduledFor) : null;
                let scheduledText = "";
                if (scheduledDate && !isNaN(scheduledDate.getTime())) {
                    scheduledText = ` (Scheduled: ${format(scheduledDate, 'MMM d, yyyy')})`;
                }
                content = (
                    <>
                        <ActionContent>
                            Follow up in {action.data.duration} {action.data.unit}{action.data.duration !== 1 ? 's' : ''}{scheduledText}.
                        </ActionContent>
                        {action.data.details && (
                             <ActionDetails>
                                <ActionDetailItem><strong>Details:</strong> {action.data.details}</ActionDetailItem>
                            </ActionDetails>
                        )}
                    </>
                );
            }
            break;
        case 'prescription':
            icon = '💊';
            title = 'Prescription';
            if (isPrescriptionData(action.data)) {
                content = (
                    <ActionDetails>
                        <ActionDetailItem><strong>Medication:</strong> {action.data.medicationName}</ActionDetailItem>
                        <ActionDetailItem><strong>Dosage:</strong> {action.data.dosage}</ActionDetailItem>
                        <ActionDetailItem><strong>Frequency:</strong> {action.data.frequency}</ActionDetailItem>
                        {action.data.details && (
                             <ActionDetailItem><strong>Details:</strong> {action.data.details}</ActionDetailItem>
                        )}
                    </ActionDetails>
                );
            }
            break;
    }
    
    const dateObject = new Date(action.createdAt);
    let formattedTime = "Invalid Date";
    if (!isNaN(dateObject.getTime())) {
        formattedTime = format(dateObject, 'MMM d, h:mm a');
    }

    return (
        <ActionItem>
            <ActionTitle>
                <ActionIcon>{icon}</ActionIcon>
                {title}
                <ActionTime>{formattedTime}</ActionTime>
            </ActionTitle>
            {content} 
        </ActionItem>
    );
};

const ActionStream: React.FC = () => {
    const { actions, loading, error } = useActions();

    if (loading) {
        return (
            <ActionStreamContainer>
                <LoadingState>Loading actions...</LoadingState>
            </ActionStreamContainer>
        );
    }

    if (error) {
        return (
            <ActionStreamContainer>
                <ErrorState>{error}</ErrorState>
            </ActionStreamContainer>
        );
    }

    if (!actions.length) {
        return (
            <ActionStreamContainer>
                <EmptyState>Actions detected during conversation will appear here.</EmptyState>
            </ActionStreamContainer>
        );
    }

    return (
        <ActionStreamContainer>
            {actions.map(action => (
                <ActionItemComponent key={action.id} action={action} />
            ))}
        </ActionStreamContainer>
    );
};

export default ActionStream;
