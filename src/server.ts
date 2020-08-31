import { App } from "@octokit/app";
import pluginRetry from "@octokit/plugin-retry";
import pluginThrottling from "@octokit/plugin-throttling";
import Octokit from "@octokit/rest";
import express from "express";
import { Application } from "probot";

export = (app: Application) => {
  const router: express.Router = app.route("/roboose");

  router.use(express.urlencoded({ extended: true }));

  router.post("/students", async (req, res) => {
    try {
      const { github, hopkins } = req.body;
      if (github === undefined || hopkins === undefined)
        throw "Incomplete form";
      const octokit = robooseOctokit();
      /*await octokit.issues.createComment({
        owner: "jhu-oose",
        repo: `${process.env.COURSE}-staff`,
        issue_number: await getTableIndex(octokit, "students"),
        body: serialize(req.body)
      });*/
      await octokit.teams.addOrUpdateMembership({
        team_id: (await octokit.teams.getByName({
          org: "jhu-oose",
          team_slug: `${process.env.COURSE}-students`
        })).data.id,
        username: github,
        role: "member"
      });
      await octokit.repos.createInOrg({
        org: "jhu-oose",
        name: `${process.env.COURSE}-student-${github}`,
        description: "Private forum and individual assignments",
        private: true,
        has_wiki: false
      });
      await octokit.teams.addOrUpdateRepo({
        team_id: (await octokit.teams.getByName({
          org: "jhu-oose",
          team_slug: `${process.env.COURSE}-staff`
        })).data.id,
        owner: "jhu-oose",
        repo: `${process.env.COURSE}-student-${github}`,
        permission: "admin"
      });
      await octokit.repos.addCollaborator({
        owner: "jhu-oose",
        repo: `${process.env.COURSE}-student-${github}`,
        username: github,
        permission: "admin"
      });
      // change this to add assignment 1 template
      await octokit.repos.createOrUpdateFile({
        owner: "jhu-oose",
        repo: `${process.env.COURSE}-student-${github}`,
        path: "homeworks/hw1/srs.md",
        message: "Add Homework 1 template - srs.md",
        content: (await octokit.repos.getContents({
          owner: "jhu-oose",
          repo: `${process.env.COURSE}-staff`,
          path: "hw/hw1/srs.md"
        })).data.content
      });
      res.redirect(
        "https://darvishdarab.github.io/cs421_f20/docs/onboarding_success/"
      );
    } catch (error) {
      console.error(error);
      res.redirect(
        "https://darvishdarab.github.io/cs421_f20/docs/onboarding_error/"
      );
    }
  });

  router.post("/assignments", async (req, res) => {
    try {
      const { assignment, github, commit } = req.body;
      if (
        assignment === undefined ||
        github === undefined ||
        commit === undefined
      )
        throw "Incomplete form";
      const octokit = robooseOctokit();
      await octokit.repos.getContents({
        owner: "jhu-oose",
        repo: `${process.env.COURSE}-student-${github}`,
        path: `homeworks/${assignment}.md`,
        ref: commit
      });
      const submission = {
        assignment,
        github,
        commit,
        time: new Date()
      };
      await octokit.issues.createComment({
        owner: "jhu-oose",
        repo: `${process.env.COURSE}-staff`,
        issue_number: await getTableIndex(octokit, "assignments"),
        body: serialize(submission)
      });
      await octokit.issues.create({
        owner: "jhu-oose",
        repo: `${process.env.COURSE}-student-${github}`,
        title: `Homework ${assignment} received`,
        body: `${serialize(submission)}

/cc @${github}
`
      });
      res.redirect("https://darvishdarab.github.io/cs421_f20/docs/onboarding_success/");
    } catch (error) {
      console.error(error);
      res.redirect("https://darvishdarab.github.io/cs421_f20/docs/onboarding_error/");
    }
  });

  router.post("/groups", async (req, res) => {
    try {
      const {
        identifier,
        members: membersWithSpaces
      } = req.body;
      if (
        identifier === undefined ||
        membersWithSpaces === undefined
      )
        throw "Incomplete form";
      const members = membersWithSpaces.filter((x: string) => x !== "");
      const octokit = robooseOctokit();
      for (const member of members) {
        await octokit.teams.getMembership({
          team_id: (await octokit.teams.getByName({
            org: "jhu-oose",
            team_slug: `${process.env.COURSE}-students`
          })).data.id,
          username: member
        });
      }
      await octokit.teams.create({
        org: "jhu-oose",
        name: `${process.env.COURSE}-group-${identifier}`,
        privacy: "closed"
      });
      await octokit.repos.createInOrg({
        org: "jhu-oose",
        name: `${process.env.COURSE}-group-${identifier}`,
        description: "Group project",
        private: true,
        has_wiki: false
      });
      await octokit.teams.addOrUpdateRepo({
        team_id: (await octokit.teams.getByName({
          org: "jhu-oose",
          team_slug: `${process.env.COURSE}-group-${identifier}`
        })).data.id,
        owner: "jhu-oose",
        repo: `${process.env.COURSE}-group-${identifier}`,
        permission: "admin"
      });
      await octokit.teams.addOrUpdateRepo({
        team_id: (await octokit.teams.getByName({
          org: "jhu-oose",
          team_slug: `${process.env.COURSE}-staff`
        })).data.id,
        owner: "jhu-oose",
        repo: `${process.env.COURSE}-group-${identifier}`,
        permission: "admin"
      });
      for (const member of members) {
        await octokit.teams.addOrUpdateMembership({
          team_id: (await octokit.teams.getByName({
            org: "jhu-oose",
            team_slug: `${process.env.COURSE}-group-${identifier}`
          })).data.id,
          username: member,
          role: "member"
        });
      }
      await octokit.repos.createOrUpdateFile({
        owner: "jhu-oose",
        repo: `${process.env.COURSE}-group-${identifier}`,
        path: "docs/SRS.md",
        message: "Add docs/SRS.md",
        content: (await octokit.repos.getContents({
          owner: "jhu-oose",
          repo: `${process.env.COURSE}-staff`,
          path: "project/srs.md"
        })).data.content
      });
      res.redirect("https://darvishdarab.github.io/cs421_f20/docs/group_success/");
    } catch (error) {
      console.error(error);
      res.redirect(
        "https://darvishdarab.github.io/cs421_f20/docs/group_error/"
      );
    }
  });
};

function robooseOctokit(): Octokit {
  return new (Octokit.plugin([pluginThrottling, pluginRetry]))({
    async auth() {
      const app = new App({
        id: Number(process.env.APP_ID),
        privateKey: String(process.env.PRIVATE_KEY)
      });
      const installationAccessToken = await app.getInstallationAccessToken({
        installationId: Number(process.env.INSTALLATION_ID)
      });
      return `token ${installationAccessToken}`;
    },
    throttle: {
      onRateLimit: () => true,
      onAbuseLimit: () => true
    }
  });
}

async function getConfiguration(octokit: Octokit): Promise<any> {
  return JSON.parse(await getStaffFile(octokit, "configuration.json"));
}

async function getStaffFile(octokit: Octokit, path: string): Promise<string> {
  return Buffer.from(
    (await octokit.repos.getContents({
      owner: "jhu-oose",
      repo: `${process.env.COURSE}-staff`,
      path
    })).data.content,
    "base64"
  ).toString();
}

async function getTableIndex(octokit: Octokit, table: string): Promise<number> {
  return (await getConfiguration(octokit)).database[table];
}

function serialize(data: any): string {
  return `\`\`\`json
${JSON.stringify(data, undefined, 2)}
\`\`\`
`;
}
