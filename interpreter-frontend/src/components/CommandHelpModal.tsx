import React from 'react';
import styled from 'styled-components';
import { Theme } from '../theme';

type ThemedProps = { theme: Theme };

const ModalOverlay = styled.div<{ $isOpen: boolean }>`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.6);
  display: ${({ $isOpen }) => ($isOpen ? 'flex' : 'none')};
  align-items: center;
  justify-content: center;
  z-index: 1000; // Ensure it's on top
  opacity: ${({ $isOpen }) => ($isOpen ? 1 : 0)};
  transition: opacity 0.3s ease;
`;

const ModalContent = styled.div<ThemedProps>`
  background-color: ${({ theme }) => theme.colors.background.card};
  padding: ${({ theme }) => theme.spacing.xl};
  border-radius: ${({ theme }) => theme.borderRadius.lg};
  border: 1px solid ${({ theme }) => theme.colors.border.light};
  box-shadow: ${({ theme }) => theme.shadows.lg};
  max-width: 500px;
  width: 90%;
  color: ${({ theme }) => theme.colors.text.primary};
  position: relative;
  max-height: 80vh;
  overflow-y: auto;
`;

const ModalHeader = styled.h3<ThemedProps>`
  margin-top: 0;
  margin-bottom: ${({ theme }) => theme.spacing.lg};
  color: ${({ theme }) => theme.colors.text.primary};
  font-weight: ${({ theme }) => theme.typography.weights.bold};
`;

const ModalCloseButton = styled.button<ThemedProps>`
  position: absolute;
  top: ${({ theme }) => theme.spacing.md};
  right: ${({ theme }) => theme.spacing.md};
  background: none;
  border: none;
  font-size: 1.5rem;
  color: ${({ theme }) => theme.colors.text.secondary};
  cursor: pointer;
  padding: 0;
  line-height: 1;

  &:hover {
    color: ${({ theme }) => theme.colors.text.primary};
  }
`;

const CommandList = styled.ul<ThemedProps>`
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: ${({ theme }) => theme.spacing.lg};
`;

const CommandItem = styled.li<ThemedProps>`
    border-left: 3px solid ${({ theme }) => theme.colors.dashboard.highlight};
    padding-left: ${({ theme }) => theme.spacing.md};
`;

const CommandName = styled.strong<ThemedProps>`
    display: block;
    margin-bottom: ${({ theme }) => theme.spacing.xs};
    color: ${({ theme }) => theme.colors.text.primary};
`;

const CommandDescription = styled.p<ThemedProps>`
    margin: 0 0 ${({ theme }) => theme.spacing.xs} 0;
    font-size: ${({ theme }) => theme.typography.sizes.sm};
    color: ${({ theme }) => theme.colors.text.secondary};
`;

const CommandArgs = styled.span<ThemedProps>`
    font-size: ${({ theme }) => theme.typography.sizes.xs};
    color: ${({ theme }) => theme.colors.text.muted};
    font-style: italic;
`;

interface CommandHelpModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const CommandHelpModal: React.FC<CommandHelpModalProps> = ({ isOpen, onClose }) => {
    if (!isOpen) return null;

    return (
        <ModalOverlay $isOpen={isOpen} onClick={onClose}> {/* Close on overlay click */}
            <ModalContent onClick={(e) => e.stopPropagation()}> {/* Prevent closing when clicking content */}
                <ModalCloseButton onClick={onClose}>&times;</ModalCloseButton>
                <ModalHeader>Voice Command Help</ModalHeader>
                <CommandList>
                    <CommandItem>
                        <CommandName>Take Note</CommandName>
                        <CommandDescription>
                            Records a clinical note. Clearly state the content of the note after the command.
                        </CommandDescription>
                        <CommandArgs>Example: "Take a note the patient feels better today."</CommandArgs>
                    </CommandItem>
                    <CommandItem>
                        <CommandName>Schedule Follow Up</CommandName>
                        <CommandDescription>
                            Schedules a follow-up task. Specify the duration (number) and unit (day, week, month).
                        </CommandDescription>
                        <CommandArgs>Example: "Schedule follow up 2 weeks" or "Schedule a follow up in 1 month for reassessment."</CommandArgs>
                    </CommandItem>
                    <CommandItem>
                        <CommandName>Write Prescription</CommandName>
                        <CommandDescription>
                            Records a prescription. Clearly state the medication name, dosage, and frequency.
                        </CommandDescription>
                        <CommandArgs>Example: "Write prescription Amoxicillin 500mg twice daily."</CommandArgs>
                    </CommandItem>
                </CommandList>
            </ModalContent>
        </ModalOverlay>
    );
};

export default CommandHelpModal; 