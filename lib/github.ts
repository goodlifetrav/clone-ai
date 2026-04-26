export interface GitHubRepo {
  id: number
  name: string
  full_name: string
  private: boolean
  html_url: string
}

export async function createGitHubRepo(
  accessToken: string,
  repoName: string,
  isPrivate: boolean = false
): Promise<GitHubRepo> {
  const response = await fetch('https://api.github.com/user/repos', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: repoName,
      private: isPrivate,
      auto_init: false,
    }),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.message || 'Failed to create GitHub repo')
  }

  return response.json()
}

export async function pushFileToGitHub(
  accessToken: string,
  owner: string,
  repo: string,
  content: string,
  commitMessage: string = 'Initial commit from CloneAI'
): Promise<void> {
  const encodedContent = Buffer.from(content).toString('base64')

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/index.html`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: commitMessage,
        content: encodedContent,
      }),
    }
  )

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.message || 'Failed to push file to GitHub')
  }
}

export async function getGitHubUser(accessToken: string): Promise<{ login: string; name: string }> {
  const response = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github.v3+json',
    },
  })

  if (!response.ok) {
    throw new Error('Failed to get GitHub user')
  }

  return response.json()
}
