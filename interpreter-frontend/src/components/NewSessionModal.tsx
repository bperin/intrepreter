import React, { useState, useEffect } from "react";
import styled from "styled-components";
import { Theme } from "../theme";
import { useConversation } from "../context/ConversationContext";
import api from "../lib/api";

type ThemedProps = { theme: Theme };

interface PatientData {
    firstName: string;
    lastName: string;
    dob: string;
}

// Export the props interface
export interface NewSessionModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSessionCreated: () => void;
}

const ModalOverlay = styled.div<{ $isOpen: boolean }>`
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: rgba(0, 0, 0, 0.7);
    display: ${({ $isOpen }) => ($isOpen ? "flex" : "none")};
    align-items: center;
    justify-content: center;
    z-index: 1000;
`;

const ModalContent = styled.div<ThemedProps>`
    background-color: ${({ theme }) => theme.colors.background.secondary};
    padding: ${({ theme }) => theme.spacing.xl};
    border-radius: ${({ theme }) => theme.borderRadius.lg};
    box-shadow: ${({ theme }) => theme.shadows.lg};
    width: 100%;
    max-width: 400px;
    border: 1px solid ${({ theme }) => theme.colors.border.light};
`;

const ModalHeader = styled.h2<ThemedProps>`
    color: ${({ theme }) => theme.colors.text.primary};
    margin-bottom: ${({ theme }) => theme.spacing.lg};
    font-size: ${({ theme }) => theme.typography.sizes.lg};
    font-weight: ${({ theme }) => theme.typography.weights.semibold};
`;

const Form = styled.form`
    display: flex;
    flex-direction: column;
    gap: ${({ theme }) => theme.spacing.md};
`;

const FormGroup = styled.div`
    display: flex;
    flex-direction: column;
    gap: ${({ theme }) => theme.spacing.xs};
`;

const Label = styled.label<ThemedProps>`
    color: ${({ theme }) => theme.colors.text.secondary};
    font-size: ${({ theme }) => theme.typography.sizes.sm};
    font-weight: ${({ theme }) => theme.typography.weights.medium};
`;

const Input = styled.input<ThemedProps>`
    padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: ${({ theme }) => theme.borderRadius.md};
    background-color: #000000;
    color: #ffffff;
    font-size: ${({ theme }) => theme.typography.sizes.base};
    transition: all 0.3s ease-in-out;
    animation: fadeIn 0.5s ease-in-out;

    @keyframes fadeIn {
        from {
            opacity: 0;
            transform: translateY(5px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }

    &:focus {
        outline: none;
        border-color: rgba(255, 255, 255, 0.5);
    }

    &::placeholder {
        color: rgba(255, 255, 255, 0.5);
    }
`;

const ButtonGroup = styled.div`
    display: flex;
    justify-content: flex-end;
    gap: ${({ theme }) => theme.spacing.md};
    margin-top: ${({ theme }) => theme.spacing.lg};
`;

const Button = styled.button<{ $primary?: boolean } & ThemedProps>`
    padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.lg};
    border-radius: ${({ theme }) => theme.borderRadius.md};
    cursor: pointer;
    font-weight: ${({ theme }) => theme.typography.weights.medium};
    transition: all 0.2s ease;
    border: 1px solid ${({ theme, $primary }) => ($primary ? theme.colors.dashboard.highlight : theme.colors.border.light)};
    background-color: ${({ theme, $primary }) => ($primary ? theme.colors.dashboard.highlight : "transparent")};
    color: ${({ theme, $primary }) => ($primary ? theme.colors.background.primary : theme.colors.text.secondary)};

    &:hover {
        opacity: 0.8;
    }
`;

const NewSessionModal: React.FC<NewSessionModalProps> = ({ isOpen, onClose, onSessionCreated }) => {
    const [firstName, setFirstName] = useState("");
    const [lastName, setLastName] = useState("");
    const [dob, setDob] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    
    // Add effect to log prop changes
    useEffect(() => {
        console.log(`[NewSessionModal] isOpen prop changed to: ${isOpen}`);
    }, [isOpen]);
    
    console.log(`[NewSessionModal] Rendering with isOpen=${isOpen}, isSubmitting=${isSubmitting}`);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        
        if (!firstName || !lastName || !dob) {
            setError("Please fill in all required fields");
            return;
        }
        
        try {
            setIsSubmitting(true);
            
            // Use the configured api instance instead of direct axios
            const response = await api.post('/api/conversations', {
                firstName,
                lastName,
                dob,
                patientLanguage: "es" // Default to Spanish for now
            });
            
            console.log("[NewSessionModal] Created new session:", response.data);
            
            // Reset form
            setFirstName("");
            setLastName("");
            setDob("");
            
            // Notify parent component that session is created
            onSessionCreated();
            
        } catch (error) {
            console.error("[NewSessionModal] Error creating session:", error);
            setError("Failed to create session. Please try again.");
        } finally {
            setIsSubmitting(false);
        }
    };

    // Prevent clicks inside the modal from closing it
    const handleContentClick = (e: React.MouseEvent) => {
        e.stopPropagation();
    };

    return (
        <ModalOverlay $isOpen={isOpen} onClick={onClose}>
            <ModalContent onClick={handleContentClick}>
                <ModalHeader>Start New Patient Session</ModalHeader>
                <Form onSubmit={handleSubmit}>
                    <FormGroup>
                        <Label htmlFor="firstName">First Name</Label>
                        <Input id="firstName" type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
                    </FormGroup>
                    <FormGroup>
                        <Label htmlFor="lastName">Last Name</Label>
                        <Input id="lastName" type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} required />
                    </FormGroup>
                    <FormGroup>
                        <Label htmlFor="dob">Date of Birth</Label>
                        <Input
                            id="dob"
                            type="date" // Use date input type
                            value={dob}
                            onChange={(e) => setDob(e.target.value)}
                            required
                        />
                    </FormGroup>
                    <ButtonGroup>
                        <Button type="button" onClick={onClose}>
                            Cancel
                        </Button>
                        <Button type="submit" $primary>
                            Start Session
                        </Button>
                    </ButtonGroup>
                </Form>
            </ModalContent>
        </ModalOverlay>
    );
};

export default NewSessionModal;
