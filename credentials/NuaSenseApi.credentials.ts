import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class NuaSenseApi implements ICredentialType {
	name = 'nuaSenseApi';

	displayName = 'NuaSense API';

	icon: Icon = { light: 'file:../nodes/NuaSense/nuasense.svg', dark: 'file:../nodes/NuaSense/nuasense.dark.svg' };

	documentationUrl = 'https://github.com/nuasense/n8n-nodes-nuasense#credentials';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'Create a key at platform.nuasense.com under API Keys. The console asks for a verified phone first and shows the key once.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://api.nuasense.com/api/nuasense/v1',
			url: '/catalog',
			method: 'GET',
		},
	};
}
