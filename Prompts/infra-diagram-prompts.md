### Simple Architecture
Create a simple infrastructure architecture diagram using Mermaid showing:
- A user accessing a web application
- DNS routing to a single web server
- Web server connected to a database
- Include labels for each component
- Keep it minimal and clean

### Cloud Native Architecture
Design a cloud-native architecture diagram using Mermaid:
- Users access via CDN
- CDN routes to API Gateway
- API Gateway connects to microservices (containers or serverless)
- Microservices interact with managed database and cache
- Include object storage for static content
- Add monitoring/logging components
- Group components by cloud services

### Micro-services Architecture
Generate a Mermaid diagram showing:
- Microservices-based architecture with multiple independent services
- Each service has its own database
- Include message queue/event bus for communication
- Add CI/CD pipeline (Git repo → Build → Test → Deploy)
- Show container orchestration (e.g., Kubernetes cluster)
- Include observability (logging, monitoring)
  
### Multi-region Architecture
Create a complex infrastructure architecture diagram using Mermaid:
- Multi-region deployment with failover
- Global load balancer routing traffic geographically
- Multiple Kubernetes clusters across regions
- Service mesh for inter-service communication
- Distributed databases with replication
- Include security layers (WAF, IAM, Zero Trust)
- Add CI/CD, monitoring, alerting, and logging systems
- Clearly group components by region and function

### Enterprise LAN
Generate a Mermaid diagram representing an enterprise LAN:
- Internet → Firewall → Core Switch
- Core switch connected to distribution switches
- Distribution switches connected to access switches
- Access switches connect to end-user devices
- Include VLAN segmentation (e.g., HR, Finance, IT)
- Show hierarchical network design clearly
  
### DMZ Network
Multi-region VPC
Create a network architecture diagram using Mermaid:
- Internet traffic enters through a firewall
- Traffic routed to a DMZ zone
- DMZ contains web servers and reverse proxy
- Internal network separated with another firewall
- Internal network hosts application and database servers
- Clearly highlight security boundaries and zones

### Hybrid Network - On-Prem with Cloud
Create an advanced network architecture diagram using Mermaid:
- Global DNS routes users to nearest region
- Each region has a VPC with multiple availability zones
- Include load balancers, NAT gateways, and subnets
- Private subnets host application and database layers
- Show inter-region peering or replication
- Include failover mechanism between regions
