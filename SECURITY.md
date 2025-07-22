# Security Policy  
  
## Overview  
  
SAGECONNECT is a financial integration system that handles sensitive ERP data, API credentials, and multi-tenant configurations. This document outlines security practices and vulnerability reporting procedures.  
  
## Supported Versions  
  
| Version | Supported          |  
| ------- | ------------------ |  
| 2.5.x   | :white_check_mark: |  
| < 2.5   | :x:                |  
  
## Security Considerations  
  
### Sensitive Data Handling  
  
SAGECONNECT processes highly sensitive financial data including:  

- SAGE 300 ERP database connections and credentials
- Multi-tenant API keys and secrets for portaldeproveedores.mx  
- CFDI (tax documents) and payment information  
- Supplier and vendor data  
  
### Environment Variable Security  
  
The system uses multiple environment files containing sensitive credentials:  
  
- `.env.credentials.database` - SQL Server authentication  
- `.env.credentials.focaltec` - Multi-tenant API credentials
- `.env.credentials.mailing` - Email service credentials  
- `.env.path` - File system paths  
  
**Critical Security Practices:**  

1. Never commit credential files to version control  
2. Use `git update-index --skip-worktree` for local credential files  
3. Restrict file system permissions on credential files (600 or 640)  
4. Regularly rotate API keys and database passwords  
  
### Database Security  
  
The system connects to multiple SQL Server databases:  

- SAGE 300 databases  
- FESA parameter database  
- Authorization databases  
  
**Security Requirements:**  

- Use dedicated service accounts with minimal required permissions  
- Enable SQL Server authentication logging  
- Implement connection encryption (TLS)  
- Regular security updates for SQL Server instances  
  
### API Security  
  
Integration with portaldeproveedores.mx API requires:  

- Secure storage of tenant-specific API keys and secrets  
- HTTPS-only communication  
- Request/response logging for audit trails  
- Rate limiting and error handling  
  
### Multi-Tenant Architecture  
  
The system supports multiple companies with indexed configuration arrays. Security considerations:  

- Tenant isolation must be maintained  
- Cross-tenant data access prevention  
- Audit logging per tenant  
- Separate credential management per tenant  
  
## Deployment Security  
  
### Production Environment  
  
When deploying with PM2:  

- Run as non-privileged user  
- Enable process monitoring and restart policies  
- Implement log rotation and secure log storage  
- Use firewall rules to restrict network access  
  
### File System Security  
  
- Restrict access to CFDI storage directories  
- Secure log file permissions  
- Regular cleanup of temporary files  
- Backup encryption for sensitive data  
  
## Logging and Monitoring  
  
The system implements comprehensive logging for security monitoring:  

- All database operations are logged
- API requests and responses are tracked  
- Error conditions trigger notifications  
- Log files are date-organized for audit trails  
  
**Security Monitoring:**  

- Monitor failed authentication attempts
- Track unusual API usage patterns  
- Alert on database connection failures  
- Log file integrity monitoring  
  
## Vulnerability Reporting  
  
### Reporting Security Issues  
  
If you discover a security vulnerability, please report it responsibly:  
  
1. **Do NOT** create a public GitHub issue  
2. Email security concerns to: [SECURITY_EMAIL_TO_BE_CONFIGURED]  
3. Include detailed information about the vulnerability  
4. Allow reasonable time for investigation and patching  
  
### Response Timeline  
  
- **Initial Response:** Within 48 hours  
- **Investigation:** Within 7 days  
- **Fix Development:** Within 30 days (depending on severity)  
- **Public Disclosure:** After fix deployment and user notification  
  
## Security Best Practices  
  
### For Developers  
  
1. **Code Review:** All changes require security review  
2. **Dependency Management:** Regular updates and vulnerability scanning  
3. **Input Validation:** Validate all external data inputs  
4. **Error Handling:** Avoid exposing sensitive information in errors  
5. **Logging:** Log security events without exposing credentials  
  
### For System Administrators  
  
1. **Access Control:** Implement principle of least privilege  
2. **Network Security:** Use VPNs and firewalls appropriately  
3. **Backup Security:** Encrypt backups and test restoration  
4. **Monitoring:** Implement comprehensive security monitoring  
5. **Updates:** Keep all system components updated  
  
## Compliance Considerations  
  
Given the financial nature of the data processed:  

- Ensure compliance with local financial regulations
- Implement data retention policies  
- Consider encryption at rest for sensitive data  
- Maintain audit trails for regulatory requirements  
  
## Security Contacts  
  
- **Security Team:** Fernando Rodríguez Memije  
- **Emergency Contact:** <fmemije00@gmail.com>  
- **Business Contact:** <fmemije00@gmail.com>  
  
## Acknowledgments  
  
We appreciate the security research community's efforts in responsibly disclosing vulnerabilities and helping improve the security of SAGECONNECT.  
For more information, please refer to the [LICENSE.md](LICENSE.md) and [EULA.md](EULA.md) files in this repository.
This document is subject to change as new security practices are adopted and vulnerabilities are addressed. Please refer to the latest version in the repository for up-to-date security policies and practices.
