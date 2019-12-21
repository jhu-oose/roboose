import { App } from "@octokit/app";
import pluginRetry from "@octokit/plugin-retry";
import pluginThrottling from "@octokit/plugin-throttling";
import Octokit from "@octokit/rest";
import { Command } from "commander";
import dotenv from "dotenv";
import inquirer from "inquirer";
import open from "open";
import fs from "fs";

const program = new Command();

program
  .command("check-installation")
  .description(
    "check that you installed everything correctly and Roboose is ready to go"
  )
  .action(async () => {
    try {
      await octokit.repos.get({
        owner: "jhu-oose",
        repo: "instructors"
      });
      console.log("Roboose is ready to go!");
    } catch (error) {
      console.error(
        `Ooops, something is wrong with your installation: ${error}`
      );
    }
  });

program
  .command("init")
  .description(
    "start the course by creating the teams and repositories for staff and students as well as the issues that serve as a database; you must paste the result of running this command into your .env file for other commands to work"
  )
  .action(async () => {
    await octokit.teams.create({
      org: "jhu-oose",
      name: `${process.env.COURSE}-students`,
      privacy: "closed"
    });
    await octokit.teams.create({
      org: "jhu-oose",
      name: `${process.env.COURSE}-staff`,
      privacy: "closed"
    });

    await octokit.repos.createInOrg({
      org: "jhu-oose",
      name: `${process.env.COURSE}-staff`,
      description: "Staff forum, grading, and pedagogical material",
      private: true,
      has_projects: false,
      has_wiki: false
    });
    await octokit.repos.createInOrg({
      org: "jhu-oose",
      name: `${process.env.COURSE}-students`,
      description: "Public forum and lectures videos",
      private: true,
      has_projects: false,
      has_wiki: false
    });

    await octokit.teams.addOrUpdateRepo({
      team_id: (await octokit.teams.getByName({
        org: "jhu-oose",
        team_slug: `${process.env.COURSE}-staff`
      })).data.id,
      owner: "jhu-oose",
      repo: `${process.env.COURSE}-staff`,
      permission: "push"
    });
    await octokit.teams.addOrUpdateRepo({
      team_id: (await octokit.teams.getByName({
        org: "jhu-oose",
        team_slug: `${process.env.COURSE}-staff`
      })).data.id,
      owner: "jhu-oose",
      repo: `${process.env.COURSE}-students`,
      permission: "push"
    });
    await octokit.teams.addOrUpdateRepo({
      team_id: (await octokit.teams.getByName({
        org: "jhu-oose",
        team_slug: `${process.env.COURSE}-students`
      })).data.id,
      owner: "jhu-oose",
      repo: `${process.env.COURSE}-students`,
      permission: "pull"
    });

    for (const title of [
      "Students",
      "Assignments",
      "Feedbacks",
      "Groups",
      "Iterations"
    ]) {
      const issue = (await octokit.issues.create({
        owner: "jhu-oose",
        repo: `${process.env.COURSE}-staff`,
        title,
        labels: ["database"]
      })).data.number;
      await octokit.issues.update({
        owner: "jhu-oose",
        repo: `${process.env.COURSE}-staff`,
        issue_number: issue
      });
      console.log(`ISSUE_${title.toUpperCase()}=${issue}`);
    }
  });

program
  .command("students:check")
  .description(
    "check student registration, including whether Roboose was successful in creating their repositories and putting the template files in there, and whether the students appear registered in SIS"
  )
  .action(async () => {
    const { hopkinses } = await getConfiguration();
    const students = await getStudents();
    const registrations = await getTable(Number(process.env.ISSUE_STUDENTS));
    if (hopkinses.length !== students.length)
      console.error(
        `Number of Hopkinses (${hopkinses.length}) doesn’t match the number of registered students (${students.length}).`
      );
    for (const github of students) {
      const registration = registrations.find(
        ({ github: registrationGithub }) => github === registrationGithub
      );
      if (registration === undefined) {
        console.error(`Can’t find registration for student ${github}.`);
        continue;
      }
      if (!hopkinses.includes(registration.hopkins))
        console.error(
          `Student doesn’t appear registered in SIS. GitHub: ${github}. Hopkins: ${registration.hopkins}.`
        );
    }
    for (const hopkins of hopkinses) {
      const registration = registrations.find(
        ({ hopkins: registrationHopkins }) => hopkins === registrationHopkins
      );
      if (registration === undefined) {
        console.error(`Can’t find registration for Hopkins ${hopkins}.`);
        continue;
      }
      if (!students.includes(registration.github))
        console.error(
          `Student is in SIS but not on GitHub. GitHub: ${registration.github}. Hopkins: ${hopkins}.`
        );
    }
    for (const { github, hopkins } of registrations) {
      if (
        registrations.some(
          ({ otherGithub, otherHopkins }) =>
            github === otherGithub && hopkins !== otherHopkins
        )
      )
        console.error(`Ambiguous Hopkinses for ${github}.`);
      try {
        await octokit.repos.getContents({
          owner: "jhu-oose",
          repo: `${process.env.COURSE}-student-${github}`,
          path: "assignments/0.md"
        });
      } catch (error) {
        console.error(
          `Either there was an error with the registration process for ${github} or you forgot to remove their registration from the database when deleting them from the course.`
        );
      }
    }
  });

program
  .command("students:profiles")
  .description("open the students profiles on the browser")
  .action(async () => {
    for (const github of await getStudents()) {
      await open(
        `https://github.com/jhu-oose/${process.env.COURSE}-student-${github}`
      );
      await inquirer.prompt([
        { name: "Press ENTER to open next student’s profile" }
      ]);
    }
  });

program
  .command("students:delete <github>")
  .description("delete a student from the course")
  .action(async github => {
    if (
      !(await inquirer.prompt([
        {
          name: "confirm",
          message: `You’re about to delete student ${github} from the course. THIS ACTION CAN’T BE REVERSED. Are you sure you want to continue?`,
          type: "confirm",
          default: false
        }
      ])).confirm
    )
      process.exit(0);
    console.log(
      `You must manually remove the student data from https://github.com/jhu-oose/${process.env.COURSE}-staff/issues/${process.env.ISSUE_STUDENTS}`
    );
    console.log(
      `You may need to cancel the invitation manually at https://github.com/orgs/jhu-oose/people if the student you’re deleting hasn’t accepted it yet (there’s no endpoint in the GitHub API to automate this)`
    );
    try {
      await octokit.orgs.removeMember({
        org: "jhu-oose",
        username: github
      });
    } catch {}
    try {
      await octokit.repos.delete({
        owner: "jhu-oose",
        repo: `${process.env.COURSE}-student-${github}`
      });
    } catch {}
  });

program
  .command("students:files:upload <source> <destination>")
  .description(
    "upload a file to the students repositories, where <source> refers to the path of the file to be uploaded on the staff repository, and <destination> refers to the path that will be created on the students repositories; the file must not exist in the students repositories"
  )
  .action(async (source, destination) => {
    await uploadFile(source, destination, "student", await getStudents());
  });

program
  .command("students:files:check <path>")
  .description(
    "check that a certain file exists in the repositories of every student; this is useful to check whether the students:files:upload command succeeded"
  )
  .action(async path => {
    await checkFile(path, "student", await getStudents());
  });

program
  .command("students:files:delete <path>")
  .description(
    "delete a file from students repositories; this is useful to revert mistakes when running the students:files:upload command"
  )
  .action(async path => {
    await deleteFile(path, "student", await getStudents());
  });

program
  .command("assignments:templates:upload <assignment>")
  .description(
    "upload the template for an assignment to students repositories; this is just a special case of the students:files:upload command with the appropriate paths"
  )
  .action(async assignment => {
    await uploadFile(
      `templates/students/assignments/${assignment}.md`,
      `assignments/${assignment}.md`,
      "student",
      await getStudents()
    );
  });

program
  .command(
    "assignments:submissions:create <assignment> <github> <commit> <time>"
  )
  .description(
    "create a submission for an assignment; this is useful for when students fail to submit on their own through the web interface"
  )
  .action(async (assignment, github, commit, time) => {
    await octokit.repos.getContents({
      owner: "jhu-oose",
      repo: `${process.env.COURSE}-student-${github}`,
      path: `assignments/${assignment}.md`,
      ref: commit
    });
    const submission = {
      assignment,
      github,
      commit,
      time: new Date(time)
    };
    await octokit.issues.createComment({
      owner: "jhu-oose",
      repo: `${process.env.COURSE}-staff`,
      issue_number: Number(process.env.ISSUE_ASSIGNMENTS),
      body: serialize(submission)
    });
    await octokit.issues.create({
      owner: "jhu-oose",
      repo: `${process.env.COURSE}-student-${github}`,
      title: `Assignment ${assignment} received`,
      body: `${serialize(submission)}

/cc @${github}
`
    });
  });

program
  .command("assignments:submissions:list <github>")
  .description(
    "list the assignment submissions of a given student; this is useful for investigating problems in submission before running the assignments:submissions:create command"
  )
  .action(async github => {
    const submissions = (await getAssignmentsSubmissions()).filter(
      submission => submission.github === github
    );
    for (const submission of submissions) {
      console.log(serialize(submission));
    }
  });

program
  .command("assignments:grades:start <assignment>")
  .description(
    "start the assignment grading process; this looks at the assignment template that students should have filled in to figure out the parts of the assignment; it also looks at the list of submissions in the database; it then creates one file per assignment part for the graders; it also creates a milestone with one issue per assignment part to track the progress"
  )
  .action(async assignment => {
    const submissions = (await getAssignmentsSubmissions()).filter(
      submission => submission.assignment === assignment
    );
    await startStudentsGrade(
      `Assignment ${assignment}`,
      "assignment",
      submissions,
      `assignments/${assignment}.md`,
      `templates/students/assignments/${assignment}.md`,
      `grades/students/assignments/${assignment}`
    );
  });

program
  .command("assignments:grades:publish <assignment>")
  .description(
    "publish the grades for an assignment after the graders are done with their part; the grades are published as GitHub Issues on the students repositories and they may ask for clarifications or regrades with comments on that issue; this command works by looking at the grades files for each assignment part and aggregating the grades by student"
  )
  .action(async assignment => {
    await publishStudentsGrades(
      `Assignment ${assignment}`,
      `grades/students/assignments/${assignment}`
    );
  });

program
  .command("quiz:submissions:upload <path-to-scanned-pdfs>")
  .description(
    "upload the PDFs with the quiz to the students repositories; the name of each PDF must be the corresponding student’s GitHub identifier"
  )
  .action(async pathToScannedPdfs => {
    const pdfs = fs
      .readdirSync(pathToScannedPdfs)
      .filter(file => file.endsWith(".pdf"));
    for (const pdf of pdfs) {
      const github = pdf.slice(0, pdf.length - ".pdf".length);
      const repo = `${process.env.COURSE}-student-${github}`;
      try {
        await octokit.repos.createOrUpdateFile({
          owner: "jhu-oose",
          repo,
          path: "quiz.pdf",
          message: "Add quiz.pdf",
          content: fs
            .readFileSync(`${pathToScannedPdfs}/${pdf}`)
            .toString("base64")
        });
      } catch (error) {
        console.error(`Error with ${github}: ${error}`);
      }
    }
  });

program
  .command("quiz:grades:start")
  .description(
    "start the quiz grading process; this looks a lot like the assignments:grades:start command, except that the submissions aren’t the database, they’re just whatever is on their repository at the moment, because we assume you’re running this right after the quiz:submissions:upload command"
  )
  .action(async () => {
    const submissions = new Array<{ github: string; commit: string }>();
    for (const github of await getStudents()) {
      submissions.push({
        github,
        commit: (await octokit.repos.getCommit({
          owner: "jhu-oose",
          repo: `${process.env.COURSE}-student-${github}`,
          ref: "master"
        })).data.sha
      });
    }
    await startStudentsGrade(
      "Quiz",
      "quiz",
      submissions,
      "quiz.pdf",
      "templates/students/quiz.md",
      "grades/students/quiz"
    );
  });

program
  .command("quiz:grades:publish")
  .description(
    "publish the quiz grades; this is equivalent to the assignments:grades:publish command, but for the quiz"
  )
  .action(async () => {
    await publishStudentsGrades("Quiz", "grades/students/quiz");
  });

program
  .command("feedbacks:read")
  .description(
    "compile the feedback collected in the form for assignment submission"
  )
  .action(async () => {
    const feedbacks = await getTable(Number(process.env.ISSUE_FEEDBACKS));
    for (const feedback of feedbacks) {
      console.log(`**Assignment:** ${feedback.assignment}

**Lecture Liked:** ${feedback.feedback.lecture.liked}

**Lecture Improved:** ${feedback.feedback.lecture.improved}

**Assignment Liked:** ${feedback.feedback.assignment.liked}

**Assignment Improved:** ${feedback.feedback.assignment.improved}

---
`);
    }
    for (const feedback of feedbacks) {
      if (feedback.feedback.course !== undefined) {
        console.log(`**Course Recommend:** ${feedback.feedback.course.recommend}

**Course Liked:** ${feedback.feedback.course.liked}

**Course Improved:** ${feedback.feedback.course.improved}

**Staff Liked:** ${feedback.feedback.course.staff.liked}

**Staff Comment:** ${feedback.feedback.course.staff["open-ended"]}

---
`);
      }
    }
  });

program
  .command("groups:delete <github>")
  .description("delete a group from the course")
  .action(async github => {
    if (
      !(await inquirer.prompt([
        {
          name: "confirm",
          message: `You’re about to delete group ${github} from the course. THIS ACTION CAN’T BE REVERSED. Are you sure you want to continue?`,
          type: "confirm",
          default: false
        }
      ])).confirm
    )
      process.exit(0);
    console.log(
      `You must manually remove the group data from https://github.com/jhu-oose/${process.env.COURSE}-staff/issues/${process.env.ISSUE_GROUPS}`
    );
    try {
      await octokit.teams.delete({
        team_id: (await octokit.teams.getByName({
          org: "jhu-oose",
          team_slug: `${process.env.COURSE}-group-${github}`
        })).data.id
      });
    } catch {}
    try {
      await octokit.repos.delete({
        owner: "jhu-oose",
        repo: `${process.env.COURSE}-group-${github}`
      });
    } catch {}
  });

program
  .command("groups:files:upload <source> <destination>")
  .description(
    "upload a file to the groups repositories; this is similar to the students:files:upload command"
  )
  .action(async (source, destination) => {
    await uploadFile(source, destination, "group", await getGroups());
  });

program
  .command("groups:files:check <path>")
  .description(
    "check that a certain file exists in the repositories of every group; this is similar to the students:files:check command"
  )
  .action(async path => {
    await checkFile(path, "group", await getGroups());
  });

program
  .command("groups:files:delete <path>")
  .description(
    "delete a file from groups repositories; this is similar to the students:files:delete command"
  )
  .action(async path => {
    await deleteFile(path, "group", await getGroups());
  });

program
  .command("iterations:submissions:create <iteration>")
  .description(
    "go over the current state of each group’s repository and put it in the database as a submission; run this at the end of each iteration; this is similar in spirit to the form students use to submit their individual assignments"
  )
  .action(async iteration => {
    for (const github of await getGroups()) {
      const commit = (await octokit.repos.getCommit({
        owner: "jhu-oose",
        repo: `${process.env.COURSE}-group-${github}`,
        ref: "master"
      })).data.sha;
      const submission = {
        iteration,
        github,
        commit,
        time: new Date()
      };
      await octokit.issues.createComment({
        owner: "jhu-oose",
        repo: `${process.env.COURSE}-staff`,
        issue_number: Number(process.env.ISSUE_ITERATIONS),
        body: serialize(submission)
      });
      await octokit.issues.create({
        owner: "jhu-oose",
        repo: `${process.env.COURSE}-group-${github}`,
        title: `Iteration ${iteration} received`,
        body: `${serialize(submission)}

/cc @jhu-oose/${process.env.COURSE}-group-${slugify(github)}
`
      });
    }
  });

program
  .command("iterations:grades:start <iteration>")
  .description(
    "start the iteration grading process; this is similar to the assignments:grades:start command, except that the grading is broken per group because each advisor grades their groups, while assignments are broken per part, because each grader grades one part"
  )
  .action(async iteration => {
    const { advisors } = await getConfiguration();
    const submissions = (await getTable(
      Number(process.env.ISSUE_ITERATIONS)
    )).filter(submission => submission.iteration === iteration);
    const template = await getStaffFile(
      `templates/groups/iterations/${iteration}.md`
    );
    const milestone = (await octokit.issues.createMilestone({
      owner: "jhu-oose",
      repo: `${process.env.COURSE}-staff`,
      title: `Grade Iteration ${iteration}`
    })).data.number;
    for (const { github, commit } of submissions) {
      const path = `grades/groups/iterations/${iteration}/${github}.md`;
      const advisor = advisors[github];
      await octokit.repos.createOrUpdateFile({
        owner: "jhu-oose",
        repo: `${process.env.COURSE}-staff`,
        path,
        message: `Add ${path}`,
        content: render(template, { github, commit, advisor })
      });
      await octokit.issues.create({
        owner: "jhu-oose",
        repo: `${process.env.COURSE}-staff`,
        title: `Grade Iteration ${iteration} · ${github}`,
        labels: ["iteration"],
        milestone,
        assignees: [advisor],
        body: `[${path}](https://github.com/jhu-oose/${process.env.COURSE}-staff/blob/master/${path})

/cc @${advisor}
`
      });
    }
  });

program
  .command("iterations:grades:publish <iteration>")
  .description(
    "publish the grades for an iteration; this is similar to the assignments:grades:publish command"
  )
  .action(async iteration => {
    const gradesPath = `grades/groups/iterations/${iteration}`;
    for (const node of await listStaffDirectory(gradesPath)) {
      const github = node.slice(0, node.length - ".md".length);
      const grade = await getStaffFile(`${gradesPath}/${node}`);
      extractTotal(grade);
      await octokit.issues.create({
        owner: "jhu-oose",
        repo: `${process.env.COURSE}-group-${github}`,
        title: `Grade for Iteration ${iteration}`,
        body: `${grade}

---

${footer(`jhu-oose/${process.env.COURSE}-group-${slugify(github)}`)}
`
      });
    }
    await octokit.issues.updateMilestone({
      owner: "jhu-oose",
      repo: `${process.env.COURSE}-staff`,
      milestone_number: (await octokit.paginate(
        octokit.issues.listMilestonesForRepo.endpoint.merge({
          owner: "jhu-oose",
          repo: `${process.env.COURSE}-staff`
        })
      )).find(milestone => milestone.title === `Grade Iteration ${iteration}`)
        .number,
      state: "closed"
    });
  });

program
  .command("final-grades")
  .description(
    "compute the final grades taking in account individual assignments, the quiz, group project iterations, and individual point adjustments (either for extra credit or because of outstanding good or bad performance on the group project)"
  )
  .action(async () => {
    const {
      allowedLateDays,
      lateDaysPenalty,
      ignoredAssignments,
      pointAdjustments,
      breakdown,
      cutoffs
    } = await getConfiguration();
    const studentsGrades = new Map<GitHub, any>();
    const groupsGrades = new Map<GitHub, any>();
    const gradesCounts = new Map<string, number>();
    const students = await getStudents();
    const groups = await getGroups();
    const registrations = await getTable(Number(process.env.ISSUE_STUDENTS));
    const studentsGroupMemberships = await getStudentsGroupMemberships();
    const assignments = await listStaffDirectory("grades/students/assignments");
    const iterations = await listStaffDirectory("grades/groups/iterations");
    const assignmentsSubmissions = await getAssignmentsSubmissions();
    for (const github of students)
      studentsGrades.set(github, {
        github,
        hopkins: registrations.find(
          ({ github: registrationGithub }) => registrationGithub === github
        ).hopkins,
        assignments: new Map<string, number>(),
        lateDays: new Map<string, number>()
      });
    for (const assignment of assignments) {
      const grades = new Map(
        [
          ...(await computeGrades(
            `grades/students/assignments/${assignment}`
          )).entries()
        ].map(([github, grade]) => [slugify(github), grade])
      );
      for (const [github, grade] of studentsGrades) {
        if (
          ignoredAssignments[github] !== undefined &&
          ignoredAssignments[github].assignments.includes(assignment)
        )
          continue;
        const githubSlug = slugify(github);
        grade.assignments.set(
          assignment,
          !grades.has(githubSlug) ? 0 : extractTotal(grades.get(githubSlug)!)
        );
        grade.lateDays.set(
          assignment,
          !grades.has(githubSlug)
            ? 0
            : assignmentsSubmissions.find(
                ({
                  github: submissionGithub,
                  assignment: submissionAssignment
                }) =>
                  slugify(submissionGithub) === githubSlug &&
                  submissionAssignment === assignment
              ).lateDays
        );
      }
    }
    for (const [github, grade] of studentsGrades) {
      grade.lateDaysTotal = sum([...grade.lateDays.values()]);
      grade.lateDaysPenalty =
        lateDaysPenalty * Math.max(0, grade.lateDaysTotal - allowedLateDays);
      grade.assignmentsAverage = average([...grade.assignments.values()]);
      grade.assignmentsTotal = Math.max(
        0,
        grade.assignmentsAverage + grade.lateDaysPenalty
      );
    }
    const quizGrades = await computeGrades(`grades/students/quiz`);
    for (const [github, grade] of studentsGrades)
      grade.quiz = extractTotal(quizGrades.get(github)!);
    for (const group of groups) {
      const grades = new Map<string, number>();
      for (const iteration of iterations)
        grades.set(
          iteration,
          extractTotal(
            await getStaffFile(
              `grades/groups/iterations/${iteration}/${group}.md`
            )
          )
        );
      const total = average([...grades.values()].slice(0, grades.size - 1));
      const project = grades.get(iterations[iterations.length - 1]);
      groupsGrades.set(group, { group, grades, total, project });
      for (const [student, grade] of studentsGrades) {
        if (studentsGroupMemberships.get(student) !== group) continue;
        grade.group = group;
        grade.iterations = grades;
        grade.iterationsTotal = total;
        grade.project = project;
        grade.pointAdjustment =
          pointAdjustments[student] === undefined
            ? 0
            : pointAdjustments[student].points;
        grade.projectTotal = Math.max(0, grade.project + grade.pointAdjustment);
      }
    }
    for (const [github, grade] of studentsGrades) {
      grade.total =
        breakdown.assignments * grade.assignmentsTotal +
        breakdown.quiz * grade.quiz +
        breakdown.iterations * grade.iterationsTotal +
        breakdown.project * grade.projectTotal;
      for (const [letter, points] of Object.entries(cutoffs)) {
        if (grade.total >= (points as number)) {
          grade.grade = letter;
          break;
        }
      }
    }
    for (const letter of Object.keys(cutoffs))
      gradesCounts.set(
        letter,
        [...studentsGrades.values()].filter(({ grade }) => grade === letter)
          .length
      );
    console.log(`# Students

${tabularize([...studentsGrades.values()], [
  ["GitHub", (grade: any) => grade.github],
  ["Hopkins", (grade: any) => grade.hopkins],
  ...assignments.map(assignment => [
    `Assignment ${assignment}`,
    (grade: any) =>
      !grade.assignments.has(assignment)
        ? "—"
        : grade.assignments.get(assignment)
  ]),
  ["Assignments Average", (grade: any) => grade.assignmentsAverage],
  ...assignments.map(assignment => [
    `Late Days for Assignment ${assignment}`,
    (grade: any) =>
      !grade.lateDays.has(assignment) ? "—" : grade.lateDays.get(assignment)
  ]),
  ["Late Days Total", (grade: any) => grade.lateDaysTotal],
  ["Late Days Penalty", (grade: any) => grade.lateDaysPenalty],
  ["Assignments Total", (grade: any) => grade.assignmentsTotal],
  ["Quiz", (grade: any) => grade.quiz],
  ["Group", (grade: any) => grade.group],
  ...iterations.map(iteration => [
    `Iteration ${iteration}`,
    (grade: any) => grade.iterations.get(iteration)
  ]),
  ["Iterations Total", (grade: any) => grade.iterationsTotal],
  ["Project", (grade: any) => grade.project],
  ["Point Adjustment", (grade: any) => grade.pointAdjustment],
  ["Project Total", (grade: any) => grade.projectTotal],
  ["Total", (grade: any) => grade.total],
  ["Grade", (grade: any) => grade.grade]
] as any)}

# Groups

${tabularize([...groupsGrades.values()], [
  ["Group", (grade: any) => grade.group],
  ...iterations.map(iteration => [
    `Iteration ${iteration}`,
    (grade: any) => grade.grades.get(iteration)
  ]),
  ["Iterations Total", (grade: any) => grade.total],
  ["Project", (grade: any) => grade.project]
] as any)}

# Counts

${tabularize(
  [...gradesCounts.entries()],
  [["Grade", ([grade, count]) => grade], ["Count", ([grade, count]) => count]]
)}

# SIS

${tabularize([...studentsGrades.values()], [
  ["ID", (grade: any) => grade.hopkins],
  ["Grade", (grade: any) => grade.grade]
] as any)}
`);
  });

program
  .command("archive")
  .description("archive the repositories for the year")
  .action(async () => {
    const repositories = [
      `${process.env.COURSE}-staff`,
      `${process.env.COURSE}-students`,
      ...(await getStudents()).map(
        github => `${process.env.COURSE}-student-${github}`
      ),
      ...(await getGroups()).map(
        github => `${process.env.COURSE}-group-${github}`
      )
    ];
    for (const repo of repositories)
      await octokit.repos.update({
        owner: "jhu-oose",
        repo,
        archived: true
      });
  });

program
  .command("one-off")
  .description(
    "this doesn’t do anything by default; it exists so that you can quickly write a script to run once; don’t commit changes to this command"
  )
  .action(async () => {});

dotenv.config();

const octokit = new (Octokit.plugin([pluginThrottling, pluginRetry]))({
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

async function getConfiguration(): Promise<any> {
  return JSON.parse(await getStaffFile("configuration.json"));
}

async function getStudents(): Promise<string[]> {
  return (await octokit.paginate(
    octokit.teams.listMembers.endpoint.merge({
      team_id: (await octokit.teams.getByName({
        org: "jhu-oose",
        team_slug: `${process.env.COURSE}-students`
      })).data.id
    })
  )).map(member => member.login);
}

async function getGroups(): Promise<string[]> {
  return (await octokit.paginate(
    octokit.teams.list.endpoint.merge({
      org: "jhu-oose"
    })
  ))
    .filter(team => team.name.startsWith(`${process.env.COURSE}-group-`))
    .map(team => team.name.slice(`${process.env.COURSE}-group-`.length));
}

async function getStudentsGroupMemberships(): Promise<Map<string, string>> {
  const studentsGroupMemberships = new Map<string, string>();
  for (const group of await getGroups()) {
    const students = (await octokit.paginate(
      octokit.teams.listMembers.endpoint.merge({
        team_id: (await octokit.teams.getByName({
          org: "jhu-oose",
          team_slug: `${process.env.COURSE}-group-${group}`
        })).data.id
      })
    )).map(member => member.login);
    for (const student of students)
      studentsGroupMemberships.set(student, group);
  }
  return studentsGroupMemberships;
}

async function getStaff(): Promise<string[]> {
  return (await octokit.paginate(
    octokit.teams.listMembers.endpoint.merge({
      team_id: (await octokit.teams.getByName({
        org: "jhu-oose",
        team_slug: `${process.env.COURSE}-staff`
      })).data.id
    })
  )).map(member => member.login);
}

async function getStaffFile(path: string): Promise<string> {
  return Buffer.from(
    (await octokit.repos.getContents({
      owner: "jhu-oose",
      repo: `${process.env.COURSE}-staff`,
      path
    })).data.content,
    "base64"
  ).toString();
}

async function listStaffDirectory(path: string): Promise<string[]> {
  return (await octokit.repos.getContents({
    owner: "jhu-oose",
    repo: `${process.env.COURSE}-staff`,
    path
  })).data.map((node: any) => node.name);
}

async function getTable(issueNumber: number): Promise<any[]> {
  return (await octokit.paginate(
    octokit.issues.listComments.endpoint.merge({
      owner: "jhu-oose",
      repo: `${process.env.COURSE}-staff`,
      issue_number: issueNumber
    })
  )).map(response => deserialize(response.body));
}

async function getAssignmentsSubmissions(): Promise<any[]> {
  const { assignmentsDueTimes } = await getConfiguration();
  const allSubmissions = await getTable(Number(process.env.ISSUE_ASSIGNMENTS));
  const latestSubmissions = allSubmissions.filter(
    submission =>
      !allSubmissions.some(
        otherSubmission =>
          submission.assignment === otherSubmission.assignment &&
          submission.github === otherSubmission.github &&
          Date.parse(submission.time) < Date.parse(otherSubmission.time)
      )
  );
  const submissionsWithLateDays =
    assignmentsDueTimes === undefined
      ? latestSubmissions
      : latestSubmissions.map(submission => {
          return {
            ...submission,
            lateDays: Math.ceil(
              Math.max(
                0,
                new Date(submission.time).getTime() -
                  new Date(assignmentsDueTimes[submission.assignment]).getTime()
              ) /
                (1000 * 60 * 60 * 24)
            )
          };
        });
  return submissionsWithLateDays;
}

type RepositoryKind = "student" | "group";

async function uploadFile(
  source: string,
  destination: string,
  repositoryKind: RepositoryKind,
  githubs: string[],
  scopeGenerator: (github: string) => object = github => {
    return {};
  }
): Promise<void> {
  const template = await getStaffFile(source);
  for (const github of githubs) {
    try {
      await octokit.repos.createOrUpdateFile({
        owner: "jhu-oose",
        repo: `${process.env.COURSE}-${repositoryKind}-${github}`,
        path: destination,
        message: `Add ${destination}`,
        content: render(template, scopeGenerator(github))
      });
    } catch (error) {
      console.error(`Error with ${github}: ${error}`);
    }
  }
  await octokit.issues.create({
    owner: "jhu-oose",
    repo: `${process.env.COURSE}-students`,
    title: `File ${destination} added to your ${repositoryKind} repository`,
    body: `See \`https://github.com/jhu-oose/${process.env.COURSE}-${repositoryKind}-<identifier>/blob/master/${destination}\`.

/cc @jhu-oose/${process.env.COURSE}-students
`
  });
}

async function checkFile(
  path: string,
  repositoryKind: RepositoryKind,
  githubs: string[]
): Promise<void> {
  for (const github of githubs) {
    try {
      await octokit.repos.getContents({
        owner: "jhu-oose",
        repo: `${process.env.COURSE}-${repositoryKind}-${github}`,
        path
      });
    } catch (error) {
      console.error(`Error with ${github}: ${error}`);
    }
  }
}

async function deleteFile(
  path: string,
  repositoryKind: RepositoryKind,
  githubs: string[]
): Promise<void> {
  for (const github of githubs) {
    try {
      await octokit.repos.deleteFile({
        owner: "jhu-oose",
        repo: `${process.env.COURSE}-${repositoryKind}-${github}`,
        path,
        message: `Delete ${path}`,
        sha: (await octokit.repos.getContents({
          owner: "jhu-oose",
          repo: `${process.env.COURSE}-${repositoryKind}-${github}`,
          path
        })).data.sha
      });
    } catch (error) {
      console.error(`Error with ${github}: ${error}`);
    }
  }
}

async function startStudentsGrade(
  subject: string,
  label: string,
  submissions: { github: string; commit: string }[],
  submissionsPath: string,
  template: string,
  gradesPath: string
): Promise<void> {
  const parts = (await getStaffFile(template)).match(/(?<=^# ).*/gm);
  if (parts === null) {
    console.error(`File ${template} doesn’t include headings for parts.`);
    process.exit(1);
    throw null;
  }
  const milestone = (await octokit.issues.createMilestone({
    owner: "jhu-oose",
    repo: `${process.env.COURSE}-staff`,
    title: `Grade ${subject}`
  })).data.number;
  for (const part of parts) {
    const slug = slugify(part);
    const path = `${gradesPath}/${slug}.md`;
    const template = `# ${part}

# Rubric

## <!-- Identifier of reusable rubric item -->

**-0** <!-- Description of reusable rubric item -->

# Grades

${submissions
  .map(
    ({
      github,
      commit
    }) => `## [\`${github}\`](https://github.com/jhu-oose/${process.env.COURSE}-student-${github}/blob/${commit}/${submissionsPath}#${slug})



**Grader:** \`<!-- GitHub Identifier -->\`

`
  )
  .join("")}
`;
    await octokit.repos.createOrUpdateFile({
      owner: "jhu-oose",
      repo: `${process.env.COURSE}-staff`,
      path,
      message: `Add ${path}`,
      content: render(template)
    });
    await octokit.issues.create({
      owner: "jhu-oose",
      repo: `${process.env.COURSE}-staff`,
      title: `Grade ${subject} · ${part}`,
      labels: [label],
      milestone,
      body: `[\`${path}\`](https://github.com/jhu-oose/${process.env.COURSE}-staff/blob/master/${path})

/cc @jhu-oose/${process.env.COURSE}-staff
`
    });
  }
}

async function publishStudentsGrades(
  subject: string,
  gradesPath: string
): Promise<void> {
  const title = `Grade for ${subject}`;
  for (const [github, grade] of await computeGrades(gradesPath)) {
    try {
      if (
        (await octokit.paginate(
          octokit.issues.listForRepo.endpoint.merge({
            owner: "jhu-oose",
            repo: `${process.env.COURSE}-student-${github}`
          })
        )).some(issue => issue.title === title)
      )
        continue;
      await octokit.issues.create({
        owner: "jhu-oose",
        repo: `${process.env.COURSE}-student-${github}`,
        title,
        body: grade
      });
    } catch (error) {
      console.error(`Error with ${github}: ${error}`);
    }
  }
  await octokit.issues.updateMilestone({
    owner: "jhu-oose",
    repo: `${process.env.COURSE}-staff`,
    milestone_number: (await octokit.paginate(
      octokit.issues.listMilestonesForRepo.endpoint.merge({
        owner: "jhu-oose",
        repo: `${process.env.COURSE}-staff`
      })
    )).find(milestone => milestone.title === `Grade ${subject}`).number,
    state: "closed"
  });
}

type GitHub = string;
type Grade = string;

async function computeGrades(gradesPath: string): Promise<Map<GitHub, Grade>> {
  const errors = new Array<string>();
  function splitSection(text: string): string[][] {
    return text
      .split(/^## /m)
      .slice(1)
      .map(entry =>
        entry
          .split("\n")
          .map(line => line.trim())
          .filter(line => line.length !== 0)
      );
  }
  const lineRegExp = /^\*\*[-+]\d+\*\* /;
  const staff = await getStaff();
  const grades = new Map<GitHub, Grade>();
  for (const partPath of await listStaffDirectory(gradesPath)) {
    const partText = await getStaffFile(`${gradesPath}/${partPath}`);
    const partMatch = partText.match(
      /^# (.*?)\n+# Rubric\n(.*)\n# Grades\n(.*)/s
    );
    if (partMatch === null) {
      errors.push(
        `Part ${partPath} doesn’t have headings for Rubric and Grades.`
      );
      continue;
    }
    const [, part, rubricText, gradesText] = partMatch;
    const rubric = new Map<string, string>();
    for (const [identifier, ...contents] of splitSection(rubricText)) {
      if (rubric.has(identifier))
        errors.push(`Duplicate rubric item in ${partPath}: ${identifier}`);
      for (const line of contents)
        if (!line.match(lineRegExp))
          errors.push(
            `Line with bad format in ${partPath}, rubric item ${identifier}.`
          );
      rubric.set(identifier, contents.join("\n"));
    }
    const partGrades = new Map<GitHub, Grade>();
    for (const lines of splitSection(gradesText)) {
      const studentLine = lines[0];
      const contents = lines.slice(1, lines.length - 1);
      const graderLine = lines[lines.length - 1];
      const studentLineMatch = studentLine.match(
        /^\[`([A-Za-z0-9-]+)`\]\((.+)\)$/
      );
      if (studentLineMatch === null) {
        errors.push(
          `Student line with bad format in ${partPath}: ${studentLine}`
        );
        continue;
      }
      const [, github, url] = studentLineMatch;
      if (partGrades.has(github))
        errors.push(`Duplicate student in part ${partPath}: ${github}`);
      const renderedContents = new Array<string>();
      for (const line of contents) {
        if (rubric.has(line)) renderedContents.push(rubric.get(line)!);
        else if (line.match(lineRegExp)) renderedContents.push(line);
        else
          errors.push(
            `Line with bad format in ${partPath}, student ${github}: ${line}`
          );
      }
      const graderLineMatch = graderLine.match(
        /^\*\*Grader:\*\* `([A-Za-z0-9-]+)`$/
      );
      if (graderLineMatch === null) {
        errors.push(
          `Grader line with bad format in ${partPath}, student ${github}: ${graderLine}`
        );
        continue;
      }
      const [, grader] = graderLineMatch;
      if (!staff.includes(grader)) {
        errors.push(
          `Grader not in staff in ${partPath}, student ${github}: ${grader}`
        );
        continue;
      }
      partGrades.set(
        github,
        `# [${part}](${url})

${renderedContents.join("\n")}

${graderLine}
`
      );
    }
    if (grades.size === 0) {
      for (const [github, grade] of partGrades) grades.set(github, grade);
    } else {
      if (
        partGrades.size !== grades.size ||
        [...partGrades.keys()].some(github => !grades.has(github))
      )
        errors.push(
          `Students in part ${partPath} aren’t the same as in the other parts.`
        );
      for (const [github, grade] of partGrades)
        grades.set(github, grades.get(github) + "\n" + grade);
    }
  }
  for (const [github, grade] of grades) {
    const pointsTexts =
      grade.match(/^\*\*[-+]\d+\*\*/gm) || new Array<string>();
    const pointsNumbers = pointsTexts.map(pointsText =>
      Number(pointsText.slice("**".length, pointsText.length - "**".length))
    );
    const total = pointsNumbers.reduce((a, b) => a + b, 100);
    grades.set(
      github,
      `${grade}

---

**Total:** ${total}/100

---

${footer(github)}
`
    );
  }
  if (errors.length !== 0) {
    console.error(errors.join("\n"));
    process.exit(1);
  }
  return grades;
}

function footer(mention: string): string {
  return `Comment on this issue and \`@mention\` the grader to ask for clarifications or request a regrade.

/cc @${mention}
`;
}

function extractTotal(grade: string): number {
  const gradeMatch = grade.match(/^\*\*Total:\*\* (\d+)\/100$/m);
  if (gradeMatch === null) {
    console.error(`Failed to extract total from:\n\n${grade}`);
    process.exit(1);
    throw null;
  }
  return Math.max(0, Number(gradeMatch[1]));
}

function render(template: string, scope: object = {}): string {
  return Buffer.from(
    new Function(
      ...Object.keys(scope),
      `return \`${template.replace(/`/g, "\\`")}\`;`
    )(...Object.values(scope))
  ).toString("base64");
}

function serialize(data: any): string {
  return `\`\`\`json
${JSON.stringify(data, undefined, 2)}
\`\`\`
`;
}

function deserialize(issueBody: string): any {
  return JSON.parse(
    issueBody
      .trim()
      .replace(/^```json/, "")
      .replace(/```$/, "")
  );
}

function slugify(string: string): string {
  return string
    .toLowerCase()
    .replace(/ /g, "-")
    .replace(/[^a-z0-9\-]/g, "");
}

function sum(numbers: number[]): number {
  return numbers.reduce((a, b) => a + b, 0);
}

function average(numbers: number[]): number {
  return sum(numbers) / numbers.length;
}

function tabularize(
  entries: any[],
  fields: [string, (entry: any) => any][]
): string {
  return `|${fields.map(([title, producer]) => title).join("|")}|
${"|-".repeat(fields.length)}|
${entries
  .map(
    entry => `|${fields.map(([title, producer]) => producer(entry)).join("|")}|`
  )
  .join("\n")}`;
}

program
  .command("*")
  .description(
    "show the help; this runs if you don’t specify which command to run, for example, when you write just $ npm run dev:task"
  )
  .action(() => {
    program.help();
  });
if (process.argv.length === 2) program.help();
program.parse(process.argv);
