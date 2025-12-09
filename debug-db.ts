import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const devices = await prisma.deviceList.findMany({
        orderBy: { id: 'desc' },
        take: 5
    });
    console.log("Last 5 devices:");
    devices.forEach(d => {
        console.log(`ID: ${d.id}, IP: ${d.ipAddress}, Model: ${d.deviceModel}, UA: ${d.userAgent}, MAC: ${d.macAddress}`);
    });
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
