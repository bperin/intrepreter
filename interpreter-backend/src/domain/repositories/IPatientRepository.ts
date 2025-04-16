import { Patient } from "../../generated/prisma";

export interface IPatientRepository {
    /**
     * Finds an existing patient by first name, last name, and date of birth,
     * or creates a new one if not found.
     * @param firstName - Patient's first name.
     * @param lastName - Patient's last name.
     * @param dateOfBirth - Patient's date of birth.
     * @returns The found or newly created Patient record.
     */
    findOrCreate(firstName: string, lastName: string, dateOfBirth: Date): Promise<Patient>;

    // Add other patient-related methods if needed later, e.g., findById
    findById(id: string): Promise<Patient | null>;
}
