import React from 'react';
import styled, { keyframes } from 'styled-components';
import { Theme } from '../theme'; // Assuming theme path

type ThemedProps = { theme: Theme };

interface SummaryModalProps {
    isOpen: boolean;
    onClose: () => void;
    status: 'idle' | 'loading' | 'success' | 'error';
    summaryContent: string | null;
    error: string | null;
}

// --- Styles ---

const fadeIn = keyframes`
  from { opacity: 0; }
  to { opacity: 1; }
`;

const ModalOverlay = styled.div<ThemedProps>`
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    animation: ${fadeIn} 0.2s ease-out;
`;

const ModalContent = styled.div<ThemedProps>`
    background-color: ${({ theme }) => theme.colors.background.secondary};
    padding: ${({ theme }) => theme.spacing.xl};
    border-radius: ${({ theme }) => theme.borderRadius.lg};
    box-shadow: 0 5px 15px rgba(0, 0, 0, 0.2);
    width: 90%;
    max-width: 600px;
    max-height: 80vh;
    overflow-y: auto;
    color: ${({ theme }) => theme.colors.text.primary};
    display: flex;
    flex-direction: column;
`;

const ModalHeader = styled.h2<ThemedProps>`
    margin-top: 0;
    margin-bottom: ${({ theme }) => theme.spacing.md};
    font-size: ${({ theme }) => theme.typography.sizes.lg};
    border-bottom: 1px solid ${({ theme }) => theme.colors.border.light};
    padding-bottom: ${({ theme }) => theme.spacing.md};
`;

const ModalBody = styled.div<ThemedProps>`
    margin-bottom: ${({ theme }) => theme.spacing.lg};
    white-space: pre-wrap; // Preserve whitespace and newlines in summary
    font-size: ${({ theme }) => theme.typography.sizes.sm};
    line-height: 1.6;
`;

const ModalFooter = styled.div<ThemedProps>`
    display: flex;
    justify-content: flex-end;
    margin-top: auto; // Push footer to bottom
`;

// Use hardcoded fallbacks for button colors
const CloseButton = styled.button<ThemedProps>`
    padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.lg};
    background-color: #4A90E2; // Fallback blue
    color: #FFFFFF; // Fallback white
    border: none;
    border-radius: ${({ theme }) => theme.borderRadius.md};
    cursor: pointer;
    font-size: ${({ theme }) => theme.typography.sizes.sm};
    font-weight: ${({ theme }) => theme.typography.weights.medium};
    transition: opacity 0.2s ease;

    &:hover {
        opacity: 0.85; // Dim slightly on hover
    }
`;

const LoadingSpinner = styled.div`
  /* Add a simple spinner */
  border: 4px solid rgba(255, 255, 255, 0.3);
  border-radius: 50%;
  border-top: 4px solid #fff;
  width: 30px;
  height: 30px;
  animation: spin 1s linear infinite;
  margin: 20px auto;

  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
`;

// Use hardcoded fallback for error color
const ErrorMessage = styled.p<ThemedProps>`
    color: #FF6B6B; // Fallback red
    font-weight: ${({ theme }) => theme.typography.weights.medium};
`;

// --- Component ---

const SummaryModal: React.FC<SummaryModalProps> = ({
    isOpen,
    onClose,
    status,
    summaryContent,
    error,
}) => {
    if (!isOpen) {
        return null;
    }

    let modalTitle = '';
    let modalBodyContent: React.ReactNode = null;

    switch (status) {
        case 'loading':
            modalTitle = 'Ending Session...';
            modalBodyContent = (
                <>
                    <p>Generating conversation summary. Please wait...</p>
                    <LoadingSpinner />
                </>
            );
            break;
        case 'success':
            modalTitle = 'Session Summary';
            modalBodyContent = summaryContent ? (
                <p>{summaryContent}</p>
            ) : (
                <p>Summary generated successfully, but content is empty.</p>
            );
            break;
        case 'error':
            modalTitle = 'Error';
            modalBodyContent = (
                <ErrorMessage>
                    {error || 'An unknown error occurred while generating the summary.'}
                </ErrorMessage>
            );
            break;
        default:
            // Should not happen if called correctly, but handle gracefully
            modalTitle = 'Status Unknown';
            modalBodyContent = <p>The modal status is unclear.</p>;
    }

    return (
        <ModalOverlay>
            <ModalContent>
                <ModalHeader>{modalTitle}</ModalHeader>
                <ModalBody>{modalBodyContent}</ModalBody>
                {/* Show close button only on success or error */}
                {(status === 'success' || status === 'error') && (
                    <ModalFooter>
                        <CloseButton onClick={onClose}>Close</CloseButton>
                    </ModalFooter>
                )}
            </ModalContent>
        </ModalOverlay>
    );
};

export default SummaryModal; 