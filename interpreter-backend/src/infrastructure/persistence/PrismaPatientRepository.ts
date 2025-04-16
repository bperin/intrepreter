import { PrismaClient, Patient } from "../../generated/prisma";
import { IPatientRepository } from "../../domain/repositories/IPatientRepository";
import { injectable, inject } from "tsyringe";

@injectable()
export class PrismaPatientRepository implements IPatientRepository {
    constructor(@inject("PrismaClient") private prisma: PrismaClient) {}

    async findOrCreate(firstName: string, lastName: string, dateOfBirth: Date): Promise<Patient> {
        const existingPatient = await this.prisma.patient.findFirst({
            where: {
                firstName: firstName,
                lastName: lastName,
                dateOfBirth: dateOfBirth,
            },
        });

        if (existingPatient) {
            return existingPatient;
        }

        try {
            const newPatient = await this.prisma.patient.create({
                data: {
                    firstName: firstName,
                    lastName: lastName,
                    dateOfBirth: dateOfBirth,
                },
            });
            return newPatient;
        } catch (error: any) {
            if (error.code === "P2002") {
                const patient = await this.prisma.patient.findFirst({
                    where: {
                        firstName: firstName,
                        lastName: lastName,
                        dateOfBirth: dateOfBirth,
                    },
                });
                if (patient) return patient;
            }
            throw error;
        }
    }

    async findById(id: string): Promise<Patient | null> {
        return this.prisma.patient.findUnique({ where: { id } });
    }
}
