import { Request, response, Response, Router } from 'express'
import { IssuesListForRepoResponseData } from '@octokit/types'

import { GithubService } from './github.service'

import logger from './../../common/logger/logger'
import { IController } from '../../interfaces/IControllers'
import { DTOController } from '../../common/dto/DTOController'
import { IssueStatesEnum } from './github.enum'
import { getMongoRepository, MongoRepository } from 'typeorm'
import { GithubIssue, GithubRepo } from './github.models'
import { GithubFactory, GithubIssueFactory } from './github.factory'

interface IGithubController {
  getRepoInformation(req: Request, res: Response): Promise<Response<GithubRepo>>
}

export class GithubController implements IController, IGithubController {
  route: Router
  service: GithubService
  baseUrl: string

  constructor({ route }: DTOController) {
    this.route = route
    this.baseUrl = '/libquality/v1/github'
    this.service = new GithubService()
  }

  async init(): Promise<void> {
    this.route.get(this.baseUrl + '/repo/:repo', this.getRepoInformation)
    this.route.get(this.baseUrl + '/repo/:repo/issues', this.getRepoIssues)
  }

  getRepoInformation = async (req: Request, res: Response): Promise<Response<GithubRepo>> => {
    // get data from request
    const { repo } = req.params
    const issueState = (req.query.issue_state as IssueStatesEnum) || IssueStatesEnum.ALL

    // declare mongo repositories
    const githubDbRepo = getMongoRepository(GithubRepo)
    const githubIssueDbRepo = getMongoRepository(GithubIssue)

    if (!repo) {
      throw new Error('Repository name is invalid')
    }

    try {
      // check if repository already exists in database
      const repoIsAlreadyRegistered = await this.checkIfRepoIsAlreadyRegistered(githubDbRepo, repo)

      if (repoIsAlreadyRegistered) {
        return res.json(repoIsAlreadyRegistered)
      }

      // get repository information from Github
      logger.debug('Getting general repository information')
      const generalRepoInformation = await this.service
        .findRepoByName({ repo })
        .then((response) => {
          const allReturnedRepo = response.data.items.filter((r) => r.name === repo)
          const mostRelevant = allReturnedRepo[0]
          return mostRelevant
        }) // select the more relevant. It will be the first

      if (!generalRepoInformation) {
        throw new Error('Requested repository is not classified as a relevant project')
      }

      // register repository in database primaryli
      const owner = generalRepoInformation.owner.login
      const repoName = generalRepoInformation.name
      const repositoryUrl = `https://api.github.com/repos/${owner}/${repoName}`

      logger.debug('Pre registering repo', repo)
      const githubRepo = GithubFactory({
        owner,
        repo: repoName,
        repositoryUrl
      })
      logger.debug('Pre registered successfully')

      // get repository issues from Github
      logger.debug('Getting repository issue list with status ' + issueState.valueOf())
      const githubRepoIssueList = await this.getGithubRepoIssuesList({
        owner,
        issueState,
        repo: repoName
      }).then(this.mapToGithubIssueList)
      logger.debug('Requested repository issue list successfully fetched')

      githubRepo.quantity_of_opened_issues = githubRepoIssueList.length
      // save issues in repository database register
      const registeredGithubRepo = await githubDbRepo.save(githubRepo)
      await githubIssueDbRepo.insertMany(githubRepoIssueList)

      return res.json(registeredGithubRepo)
    } catch (error) {
      logger.error(error.message)
      return res.status(401).send({ message: error.message })
    }
  }

  getRepoIssues = async (req: Request, res: Response): Promise<any> => {
    try {
      const { repo } = req.params
      const issueState = (req.query.issue_state as IssueStatesEnum) || IssueStatesEnum.ALL

      // declare mongo repositories
      const githubDbRepo = getMongoRepository(GithubRepo)
      const githubIssueDbRepo = getMongoRepository(GithubIssue)

      if (!repo) {
        throw new Error('Repository name is invalid')
      }

      return res.json('asdfasdfasdf')
    } catch (error) {
      logger.error(error.message)
      return res.status(401).send({ message: error.message })
    }
  }

  private async getGithubRepoIssuesList({
    owner,
    repo,
    issueState
  }: {
    owner: string
    repo: string
    issueState: IssueStatesEnum
  }): Promise<IssuesListForRepoResponseData> {
    logger.debug('Getting repo information from Github...')
    const issuesList = await this.service.getRepoIssues({ owner, repo, issueState })
    return issuesList
  }

  private async saveGithubRepoInDatabase({
    githubDbRepo,
    githubRepo
  }: {
    githubDbRepo: MongoRepository<GithubRepo>
    githubRepo: GithubRepo
  }): Promise<GithubRepo> {
    try {
      logger.debug('Saving Github repository in database')
      const registered = await githubDbRepo.save(githubRepo)
      logger.debug('Github repository saved in database successfully')
      return registered
    } catch (error) {
      throw new Error(error.message)
    }
  }

  private async checkIfRepoIsAlreadyRegistered(
    githubDbRepo: MongoRepository<GithubRepo>,
    repo: string
  ): Promise<GithubRepo | undefined> {
    return githubDbRepo.findOne({ where: { name: repo } })
  }

  private mapToGithubIssueList(data: IssuesListForRepoResponseData): GithubIssue[] {
    return data.map((issue) => GithubIssueFactory(issue))
  }
}
