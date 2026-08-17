-- PostgreSQL 10 refuses ALTER TYPE ... ADD VALUE inside a multi-statement
-- migration, so each new enum value gets its own single-statement file.
ALTER TYPE "Currency" ADD VALUE 'AUD';
