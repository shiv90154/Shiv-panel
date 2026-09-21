/** @type {import('next').NextConfig} */
export default {
  poweredByHeader: false,
  serverExternalPackages: ["imapflow", "nodemailer", "mailparser", "bcryptjs"],
  experimental: { serverActions: { bodySizeLimit: "35mb" } },
  typescript: { ignoreBuildErrors: false },
};
